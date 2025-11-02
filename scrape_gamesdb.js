import fs from "fs";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const BASE_LIST_URL = "https://thegamesdb.net/list_games.php";
const BASE_GAME_URL = "https://thegamesdb.net/game.php";
const PLATFORM_ID = 7; // NES
const OUTPUT_DIR = "data";
const OUTPUT_FILE = `${OUTPUT_DIR}/nes_games_full.csv`;

async function fetchHTML(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}`);
  return await res.text();
}

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

async function scrapeGame(id) {
  const url = `${BASE_GAME_URL}?id=${id}`;
  console.log(`🔹 Scraping game id ${id}`);
  const html = await fetchHTML(url);
  const $ = cheerio.load(html);

  const title = $("div.card-header h1").text().trim() || "";
  const alias = $("div.card-header h6.text-muted").text().trim() || "";
  const overview = $("p.game-overview").text().trim() || "";
  const esrb = $("p:contains('ESRB Rating:')").text().replace("ESRB Rating:", "").trim() || "";
  const genres = $("p:contains('Genre(s):')").text().replace("Genre(s):", "").trim() || "";

  // left card contains Platform, Region, Country, Developer, Publisher, ReleaseDate, Players, Co-op
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

  const cover = leftCard.find("img.cover.cover-offset").attr("src") || "";

  // Fanarts
  const fanarts = [];
  $("div.card:contains('Other Graphic(s)') img").each((_, img) => {
    const src = $(img).attr("src")?.trim();
    if (src) fanarts.push(src);
  });

  return {
    id,
    title,
    alias,
    platform,
    region,
    country,
    developers,
    publishers,
    releaseDate,
    players,
    coOp,
    overview,
    esrb,
    genres,
    cover,
    fanarts: fanarts.join("|")
  };
}

async function main() {
  console.log("📥 Starting NES scraping...");

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

  const ids = await scrapeGameList(PLATFORM_ID);
  console.log(`✅ Found ${ids.length} games.`);

  const results = [];
  for (const id of ids) {
    try {
      const game = await scrapeGame(id);
      results.push(game);
    } catch (err) {
      console.error(`❌ Failed to scrape game ${id}:`, err.message);
    }
  }

  const headers = [
    "id","title","alias","platform","region","country","developers",
    "publishers","releaseDate","players","coOp","overview","esrb","genres","cover","fanarts"
  ];
  const csvData = results.map(g =>
    headers.map(h => `"${(g[h] || "").toString().replace(/"/g, '""')}"`).join(",")
  );
  fs.writeFileSync(OUTPUT_FILE, headers.join(",") + "\n" + csvData.join("\n"));
  console.log(`✅ Saved ${results.length} games to ${OUTPUT_FILE}`);
}

main().catch(err => {
  console.error("❌ Fatal error:", err);
});
