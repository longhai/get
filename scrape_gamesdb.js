// scrape_gamesdb.js
// ESM (Node >= 14+). Requires: node-fetch@2, cheerio@1
import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import { load } from "cheerio";

const BASE = "https://thegamesdb.net";
const PLATFORM_ID = 7; // NES
const LIST_URL = `${BASE}/list_games.php`;
const OUTPUT_DIR = "data";
const OUTPUT_CSV = path.join(OUTPUT_DIR, `NES_games.csv`);
const OUTPUT_JSON = path.join(OUTPUT_DIR, `NES_games.json`);
const CONCURRENCY = 8; // giới hạn request song song
const REQUEST_DELAY_MS = 200; // delay nhỏ giữa request mỗi worker

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

async function fetchHtml(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (GitHub Action)" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      log(`fetch error (${i + 1}/${tries}) ${url}: ${err.message}`);
      await new Promise(r => setTimeout(r, 500 + Math.random() * 800));
    }
  }
  throw new Error(`Failed to fetch ${url}`);
}

async function collectGameList(platformId) {
  const ids = new Map(); // id -> { id, title, url }
  let page = 1;
  while (true) {
    const url = `${LIST_URL}?platform_id=${platformId}&page=${page}`;
    log(`Fetch list page ${page}: ${url}`);
    let html;
    try {
      html = await fetchHtml(url);
    } catch (e) {
      log("Failed to fetch list page:", e.message);
      break;
    }
    const $ = load(html);

    // primary selector: cards with .card.border-primary (as in page HTML)
    const cards = $(".card.border-primary");
    if (cards.length > 0) {
      cards.each((_, el) => {
        const anchor = $(el).find(".card-header a[href*='game.php?id=']").first();
        if (anchor.length) {
          const href = anchor.attr("href");
          const m = href && href.match(/id=(\d+)/);
          if (m) {
            const id = m[1];
            const title = anchor.text().trim() || $(el).find(".card-footer p").first().text().trim();
            ids.set(id, { id, title, url: new URL(href, BASE).href });
          }
        }
      });
    } else {
      // fallback: any anchor to game.php
      $("a[href*='game.php?id=']").each((_, a) => {
        const href = $(a).attr("href");
        const m = href && href.match(/id=(\d+)/);
        if (m) {
          const id = m[1];
          const title = $(a).text().trim();
          ids.set(id, { id, title, url: new URL(href, BASE).href });
        }
      });
    }

    // pagination: look for "Next" link or page param
    const hasNext = $("a.page-link").filter((i, el) => $(el).text().trim().toLowerCase() === "next").length > 0;
    log(`  found ${ids.size} total so far. hasNext=${hasNext}`);
    if (!hasNext) break;
    page++;
    await new Promise(r => setTimeout(r, 400));
  }
  return Array.from(ids.values());
}

function parseKeyValueFromP($, p) {
  // p is cheerio element; return { key, value } or null
  const text = $(p).text().trim();
  // if contains ":" treat as key: value (some labels might be "ReleaseDate:" or "Release Date:")
  const m = text.match(/^([^:]{1,40}):\s*(.*)$/);
  if (m) {
    const key = m[1].trim();
    const value = m[2].trim();
    return { key, value };
  }
  // fallback: no colon: maybe "NTSC (United States of America)" or just a date
  return null;
}

function extractTextFromAnchorList($, p) {
  const anchors = $(p).find("a");
  if (anchors.length) {
    return anchors.map((_, a) => $(a).text().trim()).get().filter(Boolean).join(", ");
  }
  return $(p).text().trim();
}

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

function parseGamePage(html, pageUrl) {
  const $ = load(html);

  const title = $(".card-header h1").first().text().trim() || $("h1").first().text().trim();
  const aka = $(".card-header h6.text-muted").first().text().replace(/Also know as[:：]?/i, "").trim();
  const overview = $(".game-overview").first().text().trim() || $("meta[property='og:description']").attr("content") || "";

  const info = {
    Title: title || "",
    AKA: aka || "",
    Overview: overview || "",
    URL: pageUrl || ""
  };

  // iterate all p under .card-body (there are multiple card-body sections, so search globally)
  $("div.card-body p").each((_, p) => {
    const kv = parseKeyValueFromP($, p);
    if (kv) {
      const key = normalizeKey(kv.key);
      // if anchors exist, prefer anchor texts
      let value = $(p).find("a").length ? extractTextFromAnchorList($, p) : kv.value;
      if (key) {
        // append if existing and not duplicate
        if (info[key]) {
          if (!info[key].includes(value)) info[key] = info[key] + "; " + value;
        } else {
          info[key] = value;
        }
      } else {
        // unknown label: store under Other_{label}
        info[`Other:${kv.key}`] = kv.value;
      }
    } else {
      // fallback lines like "NTSC (United States of America)" (some pages)
      const text = $(p).text().trim();
      if (!info.Region && /(NTSC|PAL|Other|NTSC-J|NTSC-U)/i.test(text)) {
        const reg = text.match(/(NTSC-J|NTSC-U|NTSC|PAL|Other)/i);
        if (reg) info.Region = reg[1];
      }
      if (!info.Country) {
        const countryMatch = text.match(/\(([^\)]+)\)/);
        if (countryMatch) info.Country = countryMatch[1];
      }
      // date fallback
      if (!info.ReleaseDate) {
        const dateMatch = text.match(/(\d{4}-\d{2}-\d{2}|\d{4}-\d{2}|\d{4})/);
        if (dateMatch) info.ReleaseDate = dateMatch[1];
      }
    }
  });

  // also try to read footer p (many pages have release date in footer)
  $("div.card-footer p").each((_, p) => {
    const text = $(p).text().trim();
    if (!info.ReleaseDate) {
      const dateMatch = text.match(/(\d{4}-\d{2}-\d{2}|\d{4}-\d{2}|\d{4})/);
      if (dateMatch) info.ReleaseDate = dateMatch[1];
    }
  });

  // normalize keys presence
  const out = {
    Title: info.Title || "",
    AKA: info.AKA || "",
    Platform: info.Platform || "",
    Region: info.Region || "",
    Country: info.Country || "",
    Developer: info.Developer || "",
    Publisher: info.Publisher || "",
    ReleaseDate: info.ReleaseDate || "",
    Players: info.Players || "",
    "Co-op": info["Co-op"] || info.Coop || "",
    Genre: info.Genre || "",
    ESRB: info.ESRB || "",
    Overview: info.Overview || "",
    URL: info.URL || ""
  };

  return out;
}

async function fetchGameDetail(id, url) {
  try {
    const html = await fetchHtml(url);
    const parsed = parseGamePage(html, url);
    return parsed;
  } catch (err) {
    log(`Error fetching detail id=${id}: ${err.message}`);
    return null;
  }
}

async function processWithPool(items, workerFn, concurrency = CONCURRENCY) {
  const results = new Array(items.length);
  let idx = 0;

  async function worker() {
    while (true) {
      const i = idx++;
      if (i >= items.length) return;
      const it = items[i];
      try {
        results[i] = await workerFn(it, i);
      } catch (e) {
        log(`worker error index=${i}:`, e.message);
        results[i] = null;
      }
      await new Promise(r => setTimeout(r, REQUEST_DELAY_MS + Math.random() * 200));
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function saveCsv(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (!rows.length) {
    // still write header to help debug (so file exists)
    const header = ["Title","AKA","Platform","Region","Country","Developer","Publisher","ReleaseDate","Players","Co-op","Genre","ESRB","Overview","URL"];
    fs.writeFileSync(filePath, header.join(",") + "\n", "utf8");
    log("Wrote empty CSV with header:", filePath);
    return;
  }
  const header = Object.keys(rows[0]);
  const lines = [header.join(",")];
  for (const r of rows) {
    const line = header.map(h => `"${String(r[h] || "").replace(/"/g,'""').replace(/\r?\n|\r/g,' ')}"`).join(",");
    lines.push(line);
  }
  fs.writeFileSync(filePath, lines.join("\n"), "utf8");
  log(`Wrote CSV ${filePath} (${rows.length} records)`);
}

async function main() {
  try {
    log("Start scraping platform", PLATFORM_ID);
    // ensure data dir exists before running (helps git add)
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    const list = await collectGameList(PLATFORM_ID);
    log(`Collected ${list.length} game links.`);

    if (!list.length) {
      log("No games found. Writing empty CSV header for debug.");
      saveCsv(OUTPUT_CSV, []);
      return;
    }

    // Prepare items as {id, url, title}
    const items = list.map(x => ({ id: x.id, url: x.url, title: x.title }));

    // fetch details with pool
    const fetched = await processWithPool(items, async (it, i) => {
      log(`Fetching [${i + 1}/${items.length}] id=${it.id} ${it.title}`);
      const detail = await fetchGameDetail(it.id, it.url);
      if (!detail) return null;
      return detail;
    }, CONCURRENCY);

    const valid = fetched.filter(Boolean);
    log(`Parsed ${valid.length}/${items.length} valid details.`);

    // save JSON for debug
    fs.writeFileSync(OUTPUT_JSON, JSON.stringify(valid, null, 2), "utf8");
    saveCsv(OUTPUT_CSV, valid);

    log("Done.");
  } catch (err) {
    log("Fatal error:", err.message);
    process.exit(1);
  }
}

main();
