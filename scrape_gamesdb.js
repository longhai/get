// scrape_gamesdb.js
// Node >=14+, chỉ xuất CSV
import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import { load } from "cheerio";

const BASE = "https://thegamesdb.net";
const PLATFORM_ID = 7; // NES
const LIST_URL = `${BASE}/list_games.php`;
const OUTPUT_DIR = "data";
const OUTPUT_CSV = path.join(OUTPUT_DIR, `NES_games.csv`);
const CONCURRENCY = 3;          // request đồng thời thấp để tránh block
const REQUEST_DELAY_MS = 500;   // delay giữa các request

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

// fetch HTML với retry
async function fetchHtml(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/115.0.0.0 Safari/537.36",
          "Referer": BASE
        }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      log(`fetch error (${i + 1}/${tries}) ${url}: ${err.message}`);
      await new Promise(r => setTimeout(r, 500 + Math.random() * 500));
    }
  }
  throw new Error(`Failed to fetch ${url}`);
}

// bước 1: lấy id + title
async function collectGameList(platformId) {
  const ids = new Map();
  let page = 1;

  while (true) {
    const url = `${LIST_URL}?platform_id=${platformId}&page=${page}`;
    log(`Fetching list page ${page}`);
    let html;
    try { html = await fetchHtml(url); } catch (e) { break; }

    const $ = load(html);
    const cards = $(".card.border-primary");

    if (cards.length) {
      cards.each((_, el) => {
        const anchor = $(el).find(".card-header a[href*='game.php?id=']").first();
        if (anchor.length) {
          const href = anchor.attr("href");
          const m = href.match(/id=(\d+)/);
          if (m) {
            const id = m[1];
            const title = anchor.text().trim();
            ids.set(id, { id, title });
          }
        }
      });
    } else {
      // fallback anchor
      $("a[href*='game.php?id=']").each((_, a) => {
        const href = $(a).attr("href");
        const m = href.match(/id=(\d+)/);
        if (m) {
          const id = m[1];
          const title = $(a).text().trim();
          ids.set(id, { id, title });
        }
      });
    }

    // check next page
    const hasNext = $("a.page-link").filter((i, el) => $(el).text().trim().toLowerCase() === "next").length > 0;
    if (!hasNext) break;

    page++;
    await new Promise(r => setTimeout(r, 300));
  }

  return Array.from(ids.values());
}

// normalize key
function normalizeKey(k) {
  if (!k) return k;
  const s = k.toLowerCase().replace(/\s+/g, "");
  if (s.includes("platform")) return "Platform";
  if (s.includes("region")) return "Region";
  if (s.includes("country")) return "Country";
  if (s.includes("developer")) return "Developer";
  if (s.includes("publisher")) return "Publisher";
  if (s.includes("releasedate") || s.includes("release")) return "ReleaseDate";
  if (s.includes("players")) return "Players";
  if (s.includes("co-op") || s.includes("coop")) return "Co-op";
  if (s.includes("genre")) return "Genre";
  if (s.includes("esrb")) return "ESRB";
  return k.trim();
}

// parse chi tiết game
function parseGamePage(html, pageUrl) {
  const $ = load(html);
  const info = {};

  info.Title = $(".card-header h1").first().text().trim() || $("h1").first().text().trim() || "";
  info.AKA = $(".card-header h6.text-muted").first().text().replace(/Also know as[:：]?/i, "").trim() || "";
  info.URL = pageUrl;

  $("div.card-body p").each((_, p) => {
    const text = $(p).text().trim();
    const m = text.match(/^([^:]{1,40}):\s*(.*)$/);
    if (m) {
      const key = normalizeKey(m[1]);
      const value = $(p).find("a").length ? $(p).find("a").map((_, a) => $(a).text().trim()).get().join(", ") : m[2].trim();
      if (key) info[key] = value;
    } else {
      if (!info.Region) {
        const r = text.match(/(NTSC-J|NTSC-U|NTSC|PAL|Other)/i);
        if (r) info.Region = r[1];
      }
      if (!info.Country) {
        const c = text.match(/\(([^\)]+)\)/);
        if (c) info.Country = c[1];
      }
      if (!info.ReleaseDate) {
        const d = text.match(/(\d{4}-\d{2}-\d{2}|\d{4}-\d{2}|\d{4})/);
        if (d) info.ReleaseDate = d[1];
      }
    }
  });

  $("div.card-footer p").each((_, p) => {
    if (!info.ReleaseDate) {
      const d = $(p).text().trim().match(/(\d{4}-\d{2}-\d{2}|\d{4}-\d{2}|\d{4})/);
      if (d) info.ReleaseDate = d[1];
    }
  });

  const keys = ["Title","AKA","Platform","Region","Country","Developer","Publisher","ReleaseDate","Players","Co-op","Genre","ESRB","URL"];
  const out = {};
  for (const k of keys) out[k] = info[k] || "";
  return out;
}

// fetch chi tiết game
async function fetchGameDetail(id) {
  const url = `${BASE}/game.php?id=${id}`;
  try {
    const html = await fetchHtml(url);
    return parseGamePage(html, url);
  } catch (err) {
    log(`Error fetching ${id}: ${err.message}`);
    return null;
  }
}

// pool worker
async function processWithPool(items, workerFn, concurrency = CONCURRENCY) {
  const results = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (true) {
      const i = idx++;
      if (i >= items.length) return;
      const it = items[i];
      results[i] = await workerFn(it);
      await new Promise(r => setTimeout(r, REQUEST_DELAY_MS + Math.random()*200));
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results.filter(Boolean);
}

// ghi CSV
function saveCsv(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const header = ["Title","AKA","Platform","Region","Country","Developer","Publisher","ReleaseDate","Players","Co-op","Genre","ESRB","URL"];
  const lines = [header.join(",")];
  for (const r of rows) {
    const line = header.map(h => `"${String(r[h] || "").replace(/"/g,'""').replace(/\r?\n|\r/g,' ')}"`).join(",");
    lines.push(line);
  }
  fs.writeFileSync(filePath, lines.join("\n"), "utf8");
  log(`Wrote CSV ${filePath} (${rows.length} records)`);
}

// main
async function main() {
  log("Start scraping NES games");
  const list = await collectGameList(PLATFORM_ID);
  log(`Collected ${list.length} game ids`);

  if (!list.length) {
    saveCsv(OUTPUT_CSV, []);
    return;
  }

  const fetched = await processWithPool(list.map(g => g.id), fetchGameDetail, CONCURRENCY);
  saveCsv(OUTPUT_CSV, fetched);
  log("Done.");
}

main();
