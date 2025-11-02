import fs from "fs";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const BASE_LIST_URL = "https://thegamesdb.net/list_games.php";
const BASE_GAME_URL = "https://thegamesdb.net/game.php";
const PLATFORM_ID = 7; // NES
const OUTPUT_DIR = "data";
const OUTPUT_FILE = `${OUTPUT_DIR}/nes_games.csv`;

async function fetchHTML(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return await res.text();
}

async function scrapeList(platformId) {
  let page = 1;
  const gameIds = [];

  while (true) {
    const url = `${BASE_LIST_URL}?platform_id=${platformId}&page=${page}`;
    console.log(`🔹 Fetching list page ${page}`);
    const html = await fetchHTML(url);
    const $ = cheerio.load(html);

    const cards = $("div.card.border-primary");
    if (cards.length === 0) break;

    cards.each((_, el) => {
      const href = $(el).find("a").attr("href");
      const idMatch = href?.match(/id=(\d+)/);
      if (idMatch) gameIds.push(idMatch[1]);
    });

    const hasNext = $("a.page-link:contains('Next')").length > 0;
    if (!hasNext) break;
    page++;
  }

  return gameIds;
}

async function scrapeGameDetail(gameId) {
  const url = `${BASE_GAME_URL}?id=${gameId}`;
  console.log(`   🔹 Fetching game details: ${gameId}`);
  const html = await fetchHTML(url);
  const $ = cheerio.load(html);

  const title = $("h1.card-title").first().text().trim();
  const platform = $("div:contains('Platform:')").first().text().replace("Platform:", "").trim();
  const region = $("div:contains('Region:')").first().text().replace("Region:", "").trim();
  const release_date = $("div:contains('Release Date:')").first().text().replace("Release Date:", "").trim();
  const img = $("img.card-img-top").attr("src")?.trim() || "";

  return { id: gameId, title, platform, region, release_date, img };
}

async function main() {
  console.log("📥 Scraping started...");

  const gameIds = await scrapeList(PLATFORM_ID);
  console.log(`📌 Found ${gameIds.length} games`);

  const games = [];
  for (const id of gameIds) {
    try {
      const game = await scrapeGameDetail(id);
      games.push(game);
    } catch (err) {
      console.error(`❌ Failed to scrape game ${id}:`, err.message);
    }
  }

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);
  const csvHeader = "id,title,platform,region,release_date,image_url\n";
  const csvData = games
    .map(g => [g.id, g.title, g.platform, g.region, g.release_date, g.img]
      .map(x => `"${x.replace(/"/g, '""')}"`)
      .join(","))
    .join("\n");

  fs.writeFileSync(OUTPUT_FILE, csvHeader + csvData);
  console.log(`✅ Saved ${games.length} games to ${OUTPUT_FILE}`);
}

main().catch(err => {
  console.error("❌ Error:", err);
  process.exit(1);
});
