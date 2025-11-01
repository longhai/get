// scrape_gamesdb.js
// Node.js ES module (works on Node 18+)
// npm deps: node-fetch@2, cheerio
//
// - Crawl list_games.php?platform_id=7&page=...
// - Extract game ids/urls
// - Visit each game.php?id=... and parse detailed info
// - Save partial results (data/nes_partial.json) and final CSV (data/nes_games.csv)

import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const BASE = "https://thegamesdb.net";
const PLATFORM_ID = 7; // NES
const LIST_URL = `${BASE}/list_games.php`;
const OUTPUT_DIR = "data";
const PARTIAL_FILE = path.join(OUTPUT_DIR, "nes_partial.json");
const OUTPUT_CSV = path.join(OUTPUT_DIR, "nes_games.csv");

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";

// columns for CSV (fixed order)
const CSV_HEADERS = [
  "id",
  "url",
  "title",
  "also_known_as",
  "overview",
  "platform",
  "region",
  "country",
  "developers",
  "publishers",
  "release_date",
  "players",
  "co_op",
  "genres",
  "esrb",
  "trailer",
  "image_url"
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchHtml(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const txt = await res.text();
      return txt;
    } catch (err) {
      console.warn(`fetch error ${url} (${i + 1}/${tries}): ${err.message}`);
      await sleep(800 + Math.random() * 800);
    }
  }
  throw new Error(`Failed to fetch ${url}`);
}

async function collectAllGameList(platformId) {
  let page = 1;
  const list = [];
  const seen = new Set();

  while (true) {
    const url = `${LIST_URL}?platform_id=${platformId}&page=${page}`;
    console.log(`→ Fetch list page ${page}: ${url}`);
    const html = await fetchHtml(url);
    const $ = cheerio.load(html);

    // Selector covers the cards shown in the HTML you provided
    const cards = $("div.card.border-primary");
    if (cards.length === 0) {
      // fallback: sometimes links are elsewhere; try anchors as fallback
      const anchors = $("a[href^='./game.php?id='], a[href^='/game.php?id='], a[href^='game.php?id=']");
      if (anchors.length === 0) {
        console.log("  no cards or anchors found on this page -> stop");
        break;
      }
    }

    let foundThisPage = 0;
    $("div.card.border-primary").each((_, el) => {
      // anchor to game page is the wrapping <a>
      const a = cheerio(el).find("a").first();
      const href = a.attr("href") || "";
      const absolute = new URL(href, BASE).href;
      const m = absolute.match(/id=(\d+)/);
      if (!m) return;
      const id = m[1];
      if (seen.has(id)) return;
      seen.add(id);
      // title appears in card-footer -> first <p>
      const title = cheerio(el).find(".card-footer p").first().text().trim();
      // image if present
      const img = cheerio(el).find("img.card-img-top").attr("src") || "";
      list.push({ id, url: absolute, title, img });
      foundThisPage++;
    });

    // Fall back: if no div.card.border-primary found, try anchors
    if (foundThisPage === 0) {
      $("a[href*='game.php?id=']").each((_, ael) => {
        const href = cheerio(ael).attr("href");
        if (!href) return;
        const absolute = new URL(href, BASE).href;
        const m = absolute.match(/id=(\d+)/);
        if (!m) return;
        const id = m[1];
        if (seen.has(id)) return;
        seen.add(id);
        const title = cheerio(ael).text().trim();
        list.push({ id, url: absolute, title, img: "" });
      });
    }

    console.log(`  found ${foundThisPage} cards this page (${list.length} total)`);

    // detect Next link
    const nextLink = $("a.page-link").filter((i, el) => /Next/i.test(cheerio(el).text())).first();
    if (!nextLink || nextLink.length === 0) break;

    page++;
    await sleep(600 + Math.random() * 600);
  }

  console.log(`✔ Collected ${list.length} game links.`);
  return list;
}

// parse detailed game page
function parseGamePage(html, pageUrl) {
  const $ = cheerio.load(html);

  // title
  const title = $(".card-header h1").first().text().trim() || $("h1").first().text().trim();

  // also known as
  let also_known_as = $(".card-header h6.text-muted").first().text().replace(/Also know as[:：]?/i, "").trim() || "";

  // overview
  const overview = $(".game-overview").first().text().trim() || "";

  // image: prefer large boxart, or card-img-top
  let image_url = "";
  const imgEl = $(".card.border-primary img.card-img-top").first();
  if (imgEl && imgEl.attr("src")) image_url = new URL(imgEl.attr("src"), BASE).href;
  else {
    const metaImg = $("meta[property='og:image']").attr("content");
    if (metaImg) image_url = new URL(metaImg, BASE).href;
  }

  // Initialize fields
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

  // Search card-body paragraphs across page (some pages have multiple card-body sections)
  $(".card-body p, .card-footer p").each((_, pel) => {
    const p = cheerio(pel);
    const text = p.text().trim();

    // if it contains an anchor to youtube -> trailer
    const a = p.find("a[href]").first();
    if (a && a.attr("href") && /youtu/i.test(a.attr("href"))) {
      trailer = new URL(a.attr("href"), BASE).href;
    }

    // key:value style
    if (text.includes(":")) {
      const idx = text.indexOf(":");
      const key = text.slice(0, idx).trim();
      const val = text.slice(idx + 1).trim();

      const keyLower = key.toLowerCase();

      if (/platform/i.test(key)) platform = p.find("a").length ? p.find("a").map((i, el)=>cheerio(el).text().trim()).get().join(", ") : val;
      else if (/region/i.test(key)) region = val;
      else if (/country/i.test(key)) country = val;
      else if (/developer/i.test(key)) developers = p.find("a").length ? p.find("a").map((i, el)=>cheerio(el).text().trim()).get().join(", ") : val;
      else if (/publisher/i.test(key)) publishers = p.find("a").length ? p.find("a").map((i, el)=>cheerio(el).text().trim()).get().join(", ") : val;
      else if (/release|releasedate|release date/i.test(key)) release_date = val;
      else if (/player/i.test(key)) players = val;
      else if (/co-?op|coop/i.test(key)) co_op = val;
      else if (/genre/i.test(key)) {
        // join anchors if present
        genres = p.find("a").length ? p.find("a").map((i, el)=>cheerio(el).text().trim()).get().join(", ") : val;
      }
      else if (/esrb/i.test(key)) esrb = val;
      else {
        // sometimes paragraphs are like "NTSC (United States of America)" in footer -> interpret
      }
    } else {
      // handle cases like footer: second paragraph contains "NTSC <br>(United States...)"
      // attempt to detect region + country by pattern
      const regionMatch = text.match(/(NTSC|PAL|NTSC-J|NTSC-U|Other)/i);
      const countryMatch = text.match(/\(([^)]+)\)/);
      if (regionMatch && !region) region = regionMatch[1].trim();
      if (countryMatch && !country) country = countryMatch[1].trim();
      // detect date like YYYY-MM-DD or YYYY-MM-DD or YYYY
      const dateMatch = text.match(/(\d{4}-\d{2}-\d{2}|\d{4}-\d{2}|\d{4})/);
      if (dateMatch && !release_date) release_date = dateMatch[1];
    }
  });

  // If platform still empty, try .text-muted
  if (!platform) {
    platform = $(".text-muted").first().text().trim();
  }

  // Genres: also possible as a separate card-body with "Genre(s):"
  if (!genres) {
    const gP = $("p").filter((i, el) => /genre/i.test(cheerio(el).text())).first();
    if (gP && gP.length) genres = cheerio(gP).text().replace(/Genre\(s\):/i, "").trim();
  }

  // Developers/publishers fallback: check list_games page footer entries or meta tags (rare)
  if (!developers) developers = "";
  if (!publishers) publishers = "";

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
    image_url
  };
}

function rowToCsv(values) {
  return values
    .map((v) => {
      if (v === null || v === undefined) v = "";
      return `"${String(v).replace(/"/g, '""')}"`;
    })
    .join(",");
}

async function run() {
  try {
    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    // load partial results if exist (resume)
    let done = {};
    let results = [];
    if (fs.existsSync(PARTIAL_FILE)) {
      try {
        const raw = fs.readFileSync(PARTIAL_FILE, "utf-8");
        results = JSON.parse(raw);
        for (const r of results) if (r.id) done[r.id] = true;
        console.log(`Loaded ${results.length} partial results from ${PARTIAL_FILE}`);
      } catch (e) {
        console.warn("Could not read partial file, starting fresh.");
      }
    }

    // collect all game ids/urls from list pages
    const list = await collectAllGameList(PLATFORM_ID);

    // filter out already done
    const toFetch = list.filter((g) => !done[g.id]);
    console.log(`Need to fetch details for ${toFetch.length} games (total collected ${list.length}).`);

    // iterate and fetch details
    let counter = 0;
    for (const item of toFetch) {
      counter++;
      console.log(`[${counter}/${toFetch.length}] Fetching details for id=${item.id} ${item.title}`);
      try {
        const html = await fetchHtml(item.url);
        const parsed = parseGamePage(html, item.url);
        const row = {
          id: item.id,
          url: item.url,
          ...parsed
        };
        results.push(row);
        // save partial every 10 items
        if (results.length % 10 === 0) {
          fs.writeFileSync(PARTIAL_FILE, JSON.stringify(results, null, 2), "utf-8");
          console.log(`  saved ${results.length} partial records`);
        }
        // polite delay
        await sleep(600 + Math.random() * 800);
      } catch (err) {
        console.warn(`  failed to fetch ${item.url}: ${err.message}`);
        // still push a minimal record to avoid infinite retry; mark as failed
        results.push({ id: item.id, url: item.url, title: item.title, also_known_as: "", overview: "", platform: "", region: "", country: "", developers: "", publishers: "", release_date: "", players: "", co_op: "", genres: "", esrb: "", trailer: "", image_url: "", _error: err.message });
        fs.writeFileSync(PARTIAL_FILE, JSON.stringify(results, null, 2), "utf-8");
        await sleep(1000 + Math.random() * 1000);
      }
    }

    // Merge any existing earlier results (if partial file had previous records)
    // At this point 'results' contains only newly-fetched + possible previous partial loaded at start appended earlier.
    // To ensure unique and ordered, load full partial file then dedupe by id:
    const allRecords = results; // results already includes previously loaded partial items plus newly fetched ones
    const byId = {};
    for (const rec of allRecords) {
      byId[rec.id] = rec;
    }
    const final = Object.values(byId);

    // write final CSV
    const csvLines = [];
    csvLines.push(CSV_HEADERS.join(","));
    for (const rec of final) {
      const values = CSV_HEADERS.map((h) => rec[h] || "");
      csvLines.push(rowToCsv(values));
    }
    fs.writeFileSync(OUTPUT_CSV, csvLines.join("\n"), "utf-8");
    console.log(`✔ Wrote ${final.length} rows to ${OUTPUT_CSV}`);

    // write final JSON too (optional)
    fs.writeFileSync(path.join(OUTPUT_DIR, "nes_games.json"), JSON.stringify(final, null, 2), "utf-8");

    // remove partial file
    if (fs.existsSync(PARTIAL_FILE)) fs.unlinkSync(PARTIAL_FILE);
    console.log("Done.");
  } catch (err) {
    console.error("Fatal error:", err);
    process.exit(1);
  }
}

run();
