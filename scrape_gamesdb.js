// scrape_gamesdb.js
// Node.js (ES module). deps: node-fetch@2, cheerio
import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const BASE = "https://thegamesdb.net";
const PLATFORM_ID = 7; // NES
const PLATFORM_NAME = "NES";
const LIST_URL = `${BASE}/list_games.php`;
const OUTPUT_DIR = "data";
const PARTIAL_FILE = path.join(OUTPUT_DIR, "nes_partial.json");
const OUTPUT_JSON = path.join(OUTPUT_DIR, `${PLATFORM_NAME}_games.json`);
const OUTPUT_CSV = path.join(OUTPUT_DIR, `${PLATFORM_NAME}_games.csv`);

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";
const MAX_CONCURRENT = 10; // chỉnh nếu cần (ưu tiên <= 10)
const RETRY_FETCH = 3;
const PER_ITEM_DELAY_MS = 150; // delay nhẹ sau fetch từng item (để giảm tải)

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchHtml(url, tries = RETRY_FETCH) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const txt = await res.text();
      return txt;
    } catch (err) {
      console.warn(`fetch error ${url} (${i + 1}/${tries}): ${err.message}`);
      await sleep(500 + Math.random() * 800);
    }
  }
  throw new Error(`Failed to fetch ${url} after ${tries} tries`);
}

// Collect all game ids from list pages (handles pagination)
async function collectAllGameList(platformId) {
  let page = 1;
  const seen = new Set();
  const list = [];

  while (true) {
    const url = `${LIST_URL}?platform_id=${platformId}&page=${page}`;
    console.log(`→ Fetch list page ${page}: ${url}`);
    let html;
    try {
      html = await fetchHtml(url);
    } catch (e) {
      console.warn(`Failed to fetch list page ${page}: ${e.message}`);
      break;
    }
    const $ = cheerio.load(html);

    // Prefer cards layout
    const cards = $("div.card.border-primary");
    let foundThisPage = 0;

    if (cards.length > 0) {
      cards.each((_, el) => {
        const a = cheerio(el).find("a[href*='game.php?id=']").first();
        const href = a.attr("href") || "";
        const abs = new URL(href, BASE).href;
        const m = abs.match(/id=(\d+)/);
        if (m) {
          const id = m[1];
          if (!seen.has(id)) {
            seen.add(id);
            const title = cheerio(el).find(".card-footer p").first().text().trim() || a.text().trim();
            const img = cheerio(el).find("img.card-img-top").attr("src") || "";
            list.push({ id, url: abs, title, img });
            foundThisPage++;
          }
        }
      });
    } else {
      // fallback: find anchors anywhere
      $("a[href*='game.php?id=']").each((_, el) => {
        const href = cheerio(el).attr("href");
        if (!href) return;
        const abs = new URL(href, BASE).href;
        const m = abs.match(/id=(\d+)/);
        if (m) {
          const id = m[1];
          if (!seen.has(id)) {
            seen.add(id);
            const title = cheerio(el).text().trim();
            list.push({ id, url: abs, title, img: "" });
            foundThisPage++;
          }
        }
      });
    }

    console.log(`   found ${foundThisPage} items on page ${page} (total ${list.length})`);

    // detect Next link in pagination
    const hasNext = $("ul.pagination a.page-link").filter((i, el) => /Next/i.test(cheerio(el).text())).length > 0;
    if (!hasNext) break;
    page++;
    await sleep(300 + Math.random() * 300);
  }

  console.log(`✔ Collected ${list.length} game links.`);
  return list;
}

// Parse one game detail page and return normalized object
function parseGameDetailHtml(html, pageUrl) {
  const $ = cheerio.load(html);

  const title = $(".card-header h1").first().text().trim() || $("h1").first().text().trim();
  const also_known_as = $(".card-header h6.text-muted").first().text().replace(/Also know as[:：]?/i, "").trim() || "";
  const overview = $(".game-overview").first().text().trim() || "";
  let image_url = "";
  const imgEl = $(".card.border-primary img.card-img-top, .card img.card-img-top").first();
  if (imgEl && imgEl.attr("src")) image_url = new URL(imgEl.attr("src"), BASE).href;
  else {
    const og = $("meta[property='og:image']").attr("content");
    if (og) image_url = new URL(og, BASE).href;
  }

  // initialize fields
  let platform = "";
  let region = "";
  let country = "";
  let developers = "";
  let publishers = "";
  let release_date = "";
  let players = "";
  let co_op = "";
  let genres = "";
  let esrb = "";
  let trailer = "";

  // gather key: value lines from all .card-body p and footer p
  $("div.card-body p, div.card-footer p").each((_, pel) => {
    const p = cheerio(pel);
    const text = p.text().trim();
    // if anchor contains YouTube link, set trailer
    const a = p.find("a[href]").filter((i, el) => /youtu/i.test(cheerio(el).attr("href"))).first();
    if (a && a.attr("href")) trailer = new URL(a.attr("href"), BASE).href;

    if (text.includes(":")) {
      const idx = text.indexOf(":");
      const key = text.slice(0, idx).trim();
      const val = text.slice(idx + 1).trim();

      if (/platform/i.test(key)) platform = p.find("a").length ? p.find("a").map((i,el)=>cheerio(el).text().trim()).get().join(", ") : val;
      else if (/region/i.test(key)) region = val;
      else if (/country/i.test(key)) country = val;
      else if (/developer/i.test(key)) developers = p.find("a").length ? p.find("a").map((i,el)=>cheerio(el).text().trim()).get().join(", ") : val;
      else if (/publisher/i.test(key)) publishers = p.find("a").length ? p.find("a").map((i,el)=>cheerio(el).text().trim()).get().join(", ") : val;
      else if (/release/i.test(key)) release_date = val;
      else if (/player/i.test(key)) players = val;
      else if (/co-?op|coop/i.test(key)) co_op = val;
      else if (/genre/i.test(key)) genres = p.find("a").length ? p.find("a").map((i,el)=>cheerio(el).text().trim()).get().join(", ") : val;
      else if (/esrb/i.test(key)) esrb = val;
    } else {
      // fallback parse like "NTSC (United States of America)" or date-only lines in footer
      const regionMatch = text.match(/(NTSC|NTSC-J|NTSC-U|PAL|Other)/i);
      if (regionMatch && !region) region = regionMatch[1];
      const countryMatch = text.match(/\(([^)]+)\)/);
      if (countryMatch && !country) country = countryMatch[1];
      const dateMatch = text.match(/(\d{4}-\d{2}-\d{2}|\d{4}-\d{2}|\d{4})/);
      if (dateMatch && !release_date) release_date = dateMatch[1];
    }
  });

  // fallback: platform from .text-muted
  if (!platform) platform = $(".text-muted").first().text().trim() || platform;

  return {
    title,
    also_known_as,
    overview,
    platform,
    region,
    country,
    developers,
    publishers,
    release_date,
    players,
    co_op,
    genres,
    esrb,
    trailer,
    image_url,
    pageUrl
  };
}

// Worker to fetch and parse one game, with retry
async function fetchGameDetail(item) {
  const { id, url } = item;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const html = await fetchHtml(url, 2);
      const parsed = parseGameDetailHtml(html, url);
      return { id, url, title: parsed.title, also_known_as: parsed.also_known_as, overview: parsed.overview, platform: parsed.platform, region: parsed.region, country: parsed.country, developers: parsed.developers, publishers: parsed.publishers, release_date: parsed.release_date, players: parsed.players, co_op: parsed.co_op, genres: parsed.genres, esrb: parsed.esrb, trailer: parsed.trailer, image_url: parsed.image_url };
    } catch (err) {
      console.warn(`  attempt ${attempt} failed for id=${id}: ${err.message}`);
      await sleep(500 + Math.random() * 800);
    }
  }
  // return minimal record on repeated failure
  return { id, url, _error: "failed to fetch after retries" };
}

// Simple concurrency pool
async function processWithLimit(items, limit, workerFn, onProgress) {
  const results = new Array(items.length);
  let idx = 0;

  async function next() {
    while (true) {
      const i = idx++;
      if (i >= items.length) return;
      try {
        const res = await workerFn(items[i]);
        results[i] = res;
        if (onProgress) onProgress(i, res);
      } catch (err) {
        results[i] = { _error: err.message, item: items[i] };
        console.warn(`Worker error for item index ${i}: ${err.message}`);
      }
      // polite tiny delay per worker
      await sleep(PER_ITEM_DELAY_MS + Math.random() * 200);
    }
  }

  const workers = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workers }).map(() => next()));
  return results;
}

// Save CSV helper
function saveCSV(records, filePath) {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const headers = ["id","url","title","also_known_as","overview","platform","region","country","developers","publishers","release_date","players","co_op","genres","esrb","trailer","image_url"];
  const lines = [headers.join(",")];
  for (const r of records) {
    const row = headers.map(h => {
      const v = r[h] === undefined || r[h] === null ? "" : String(r[h]);
      return `"${v.replace(/"/g,'""')}"`;
    }).join(",");
    lines.push(row);
  }
  fs.writeFileSync(filePath, lines.join("\n"), "utf-8");
}

// Main
async function main() {
  try {
    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    // load partial if exists (resume)
    let partial = [];
    const doneIds = new Set();
    if (fs.existsSync(PARTIAL_FILE)) {
      try {
        partial = JSON.parse(fs.readFileSync(PARTIAL_FILE, "utf-8"));
        partial.forEach(p => { if (p && p.id) doneIds.add(p.id); });
        console.log(`Loaded ${partial.length} partial records from ${PARTIAL_FILE}`);
      } catch (e) {
        console.warn("Could not parse partial file, will start fresh.");
        partial = [];
      }
    }

    // collect list of game links
    const allList = await collectAllGameList(PLATFORM_ID);
    // filter out done ids
    const toFetch = allList.filter(x => !doneIds.has(x.id));
    console.log(`Need to fetch ${toFetch.length} details (out of ${allList.length}).`);

    // if partial had previous entries, start results with them
    const results = partial.slice();

    // process with concurrency limit
    let processedCount = 0;
    const onProgress = (index, res) => {
      processedCount++;
      // append immediately to results to persist order of fetching
      results.push(res);
      // persist partial every 25 items
      if (results.length % 25 === 0) {
        fs.writeFileSync(PARTIAL_FILE, JSON.stringify(results, null, 2), "utf-8");
        console.log(`  saved partial ${results.length} items`);
      }
      console.log(`  progress: ${processedCount}/${toFetch.length}`);
    };

    const fetched = await processWithLimit(toFetch, MAX_CONCURRENT, fetchGameDetail, onProgress);

    // merge fetched into results (fetchGameDetail already pushed items via onProgress)
    // some entries might be undefined; ensure results contains unique ids (keep latest)
    const byId = {};
    results.forEach(r => { if (r && r.id) byId[r.id] = r; });
    fetched.forEach(r => { if (r && r.id) byId[r.id] = r; });

    const final = Object.values(byId);
    // write final JSON + CSV
    fs.writeFileSync(OUTPUT_JSON, JSON.stringify(final, null, 2), "utf-8");
    saveCSV(final, OUTPUT_CSV);

    // remove partial file
    if (fs.existsSync(PARTIAL_FILE)) fs.unlinkSync(PARTIAL_FILE);

    console.log(`✔ Done. Wrote ${final.length} records to:\n  - ${OUTPUT_JSON}\n  - ${OUTPUT_CSV}`);
  } catch (err) {
    console.error("Fatal error:", err);
    process.exit(1);
  }
}

main();
