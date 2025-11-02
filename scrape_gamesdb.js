import fs from "fs";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const BASE_LIST_URL = "https://thegamesdb.net/list_games.php";
const BASE_GAME_URL = "https://thegamesdb.net/game.php";
const PLATFORM_ID = 7; // NES
const OUTPUT_DIR = "data";
const OUTPUT_FILE = `${OUTPUT_DIR}/nes_games_fast.csv`;
const CONCURRENT = 5; // số game fetch song song

async function fetchHTML(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}`);
  return await res.text();
}

// Lấy tất cả ID game từ list_games.php
async function scrapeGameList(platformId) {
  let page = 1;
  let gameIds = [];

  while (true) {
    const url = `${BASE_LIST_URL}?platform_id=${platformId}&page=${page}`;
    console.log(`🔹 Fetching list page ${page}`);
    const html = await fetchHTML(url);
    const $ = cheerio.load(html);

    const cards = $("div.card.border-primary");
    if (cards.length === 0) break;

    cards.each((_, el) => {
      const href = $(el).find("a").attr("href") || "";
      const idMatch = href.match(/id=(\d+)/);
      if (idMatch) gameIds.push(idMatch[1]);
    });

    const hasNext = $("a.page-link:contains('Next')").length > 0;
    if (!hasNext) break;
    page++;
  }

  return gameIds;
}

// Lấy thông tin chi tiết từng game
async function scrapeGame(id) {
  const url = `${BASE_GAME_URL}?id=${id}`;
  const html = await fetchHTML(url);
  const $ = cheerio.load(html);

  const title = $("div.card-header h1").text().trim() || "";
  const alias = $("div.card-header h6.text-muted").text().trim() || "";
  const overview = $("p.game-overview").text().trim() || "";
  const esrb = $("p:contains('ESRB Rating:')").text().replace("ESRB Rating:", "").trim() || "";
  const genres = $("p:contains('Genre(s):')").text().replace("Genre(s):", "").trim() || "";

  const leftCard = $("div.col-12.col-md-3.col-lg-2");
  const getText = (prefix) => leftCard.find(`p:contains('${prefix}')`).text().replace(prefix, "").trim() || "";

  const platform = getText("Platform:");
  const region = getText("Region:");
  const country = getText("Country:");
  const developers = getText("Developer(s):");
  const publishers = getText("Publisher(s):");
  const releaseDate = getText("ReleaseDate:");
  const players = getText("Players:");
  const coOp = getText("Co-op:");

  return {
    title, alias, platform, region, country,
    developers, publishers, releaseDate, players, coOp,
    overview, esrb, genres
  };
}

// Chạy song song với giới hạn CONCURRENT
async function parallelScrape(ids) {
  const results = [];
  let index = 0;

  async function worker() {
    while (index < ids.length) {
      const id = ids[index++];
      try {
        const game = await scrapeGame(id);
        results.push(game);
        console.log(`✅ Scraped: ${game.title}`);
      } catch (err) {
        console.error(`❌ Failed id ${id}: ${err.message}`);
      }
    }
  }

  const workers = Array.from({ length: CONCURRENT }, () => worker());
  await Promise.all(workers);
  return results;
}

async function main() {
  console.log("📥 Starting NES scraping...");

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

  const ids = await scrapeGameList(PLATFORM_ID);
  console.log(`✅ Found ${ids.length} games.`);

  const results = await parallelScrape(ids);

  const headers = [
    "title","alias","platform","region","country","developers",
    "publishers","releaseDate","players","coOp","overview","esrb","genres"
  ];
  const csvData = results.map(g =>
    headers.map(h => `"${(g[h] || "").replace(/"/g, '""')}"`).join(",")
  );

  fs.writeFileSync(OUTPUT_FILE, headers.join(",") + "\n" + csvData.join("\n"));
  console.log(`✅ Saved ${results.length} games to ${OUTPUT_FILE}`);
}

main().catch(err => console.error("❌ Fatal error:", err));
