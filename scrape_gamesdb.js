import fs from "fs";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const BASE_LIST_URL = "https://thegamesdb.net/list_games.php";
const BASE_GAME_URL = "https://thegamesdb.net/game.php";
const PLATFORM_ID = 7; // NES
const OUTPUT_DIR = "data";
const OUTPUT_FILE = `${OUTPUT_DIR}/nes_games.csv`;

// fetch HTML helper
async function fetchHTML(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return await res.text();
}

// scrape list page: lấy id game
async function scrapeGameIds(platformId) {
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
      const href = $(el).find("a").attr("href");
      const match = href?.match(/id=(\d+)/);
      if (match) gameIds.push(match[1]);
    });

    const hasNext = $("a.page-link:contains('Next')").length > 0;
    if (!hasNext) break;
    page++;
  }

  console.log(`✅ Found ${gameIds.length} game IDs`);
  return gameIds;
}

// scrape chi tiết game
async function scrapeGameDetail(gameId) {
  const url = `${BASE_GAME_URL}?id=${gameId}`;
  const html = await fetchHTML(url);
  const $ = cheerio.load(html);

  const title = $("div.card-header h1").text().trim();
  const alias = $("div.card-header h6.text-muted").text().replace("Also know as:", "").trim();

  const leftCard = $("div.col-12.col-md-3.col-lg-2 .card-body").first();
  const platform = leftCard.find("p:contains('Platform:') a").text().trim();
  const region = leftCard.find("p:contains('Region:')").text().replace("Region:", "").trim();
  const country = leftCard.find("p:contains('Country:')").text().replace("Country:", "").trim();
  const developers = leftCard.find("p:contains('Developer') a").map((i, el) => $(el).text().trim()).get().join("; ");
  const publishers = leftCard.find("p:contains('Publisher') a").map((i, el) => $(el).text().trim()).get().join("; ");
  const releaseDate = leftCard.find("p:contains('ReleaseDate')").text().replace("ReleaseDate:", "").trim();
  const players = leftCard.find("p:contains('Players:')").text().replace("Players:", "").trim();
  const coop = leftCard.find("p:contains('Co-op')").text().replace("Co-op:", "").trim();

  const overview = $("p.game-overview").text().trim();
  const esrb = $("p:contains('ESRB Rating:')").text().replace("ESRB Rating:", "").trim();
  const genres = $("p:contains('Genre')").text().replace("Genre(s):", "").trim();

  const cover = $("img.cover.cover-offset").attr("src")?.trim() || "";
  const fanarts = $("div.card:contains('Other Graphic(s)') img").map((i, el) => $(el).attr("src")).get().join("; ");

  return {
    id: gameId,
    title,
    alias,
    platform,
    region,
    country,
    developers,
    publishers,
    releaseDate,
    players,
    coop,
    overview,
    esrb,
    genres,
    cover,
    fanarts
  };
}

// main
async function main() {
  console.log("📥 Scraping started...");

  const gameIds = await scrapeGameIds(PLATFORM_ID);
  const results = [];

  for (const id of gameIds) {
    try {
      console.log(`⏳ Scraping game ${id}`);
      const gameData = await scrapeGameDetail(id);
      results.push(gameData);
    } catch (err) {
      console.error(`❌ Failed game ${id}:`, err.message);
    }
  }

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

  const csvHeader = "id,title,alias,platform,region,country,developers,publishers,release_date,players,coop,overview,esrb,genres,cover,fanarts\n";
  const csvData = results.map(g => Object.values(g).map(x => `"${(x || "").toString().replace(/"/g, '""')}"`).join(",")).join("\n");

  fs.writeFileSync(OUTPUT_FILE, csvHeader + csvData);
  console.log(`✅ Saved ${results.length} games to ${OUTPUT_FILE}`);
}

main().catch(err => {
  console.error("❌ Fatal error:", err);
  process.exit(1);
});
