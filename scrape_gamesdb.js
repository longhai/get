import fs from "fs";
import fetch from "node-fetch";
import * as cheerio from "cheerio";
import pMap from "p-map";

const BASE_LIST_URL = "https://thegamesdb.net/list_games.php";
const BASE_GAME_URL = "https://thegamesdb.net/game.php";
const PLATFORM_ID = 7; // NES
const OUTPUT_DIR = "data";
const OUTPUT_FILE = `${OUTPUT_DIR}/nes_games.csv`;

// Lấy danh sách game id từ list_games.php
async function fetchGameIds(platformId) {
  let page = 1;
  let gameIds = [];

  while (true) {
    const url = `${BASE_LIST_URL}?platform_id=${platformId}&page=${page}`;
    console.log(`🔹 Fetching list page ${page}`);
    const res = await fetch(url);
    const html = await res.text();
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

  console.log(`✅ Found ${gameIds.length} game IDs`);
  return gameIds;
}

// Scrape thông tin 1 game từ game.php
async function scrapeGame(id) {
  const url = `${BASE_GAME_URL}?id=${id}`;
  const res = await fetch(url);
  const html = await res.text();
  const $ = cheerio.load(html);

  // Cột bên trái chứa nhiều thông tin
  const infoCol = $(".col-12.col-md-3.col-lg-2 p");

  const platform = $(infoCol[0]).find("a").text().trim() || "";
  const region = $(infoCol[1]).text().replace("Region:", "").trim() || "";
  const country = $(infoCol[2]).text().replace("Country:", "").trim() || "";
  const developers = $(infoCol[3]).find("a").map((i, el) => $(el).text().trim()).get().join("; ") || "";
  const publishers = $(infoCol[4]).find("a").map((i, el) => $(el).text().trim()).get().join("; ") || "";
  const releaseDate = $(infoCol[5]).text().replace("ReleaseDate:", "").trim() || "";
  const players = $(infoCol[6]).text().replace("Players:", "").trim() || "";
  const coOp = $(infoCol[7]).text().replace("Co-op:", "").trim() || "";

  const title = $("div.card-header h1").first().text().trim() || "";
  const alias = $("div.card-header h6.text-muted").first().text().replace("Also know as:", "").trim() || "";
  const overview = $("p.game-overview").first().text().trim() || "";
  const esrb = $("p:contains('ESRB Rating')").text().replace("ESRB Rating:", "").trim() || "";
  const genres = $("p:contains('Genre')").text().replace("Genre(s):", "").trim() || "";

  return {
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
    genres
  };
}

// Main
async function main() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

  const gameIds = await fetchGameIds(PLATFORM_ID);

  // Chạy song song 5 request 1 lúc để nhanh hơn
  const games = await pMap(gameIds, scrapeGame, { concurrency: 5 });

  const csvHeader = [
    "title","alias","platform","region","country",
    "developers","publishers","releaseDate","players","coOp",
    "overview","esrb","genres"
  ].join(",") + "\n";

  const csvData = games.map(g => 
    Object.values(g).map(x => `"${x.replace(/"/g,'""')}"`).join(",")
  ).join("\n");

  fs.writeFileSync(OUTPUT_FILE, csvHeader + csvData);
  console.log(`✅ Saved ${games.length} games to ${OUTPUT_FILE}`);
}

main().catch(err => {
  console.error("❌ Error:", err);
  process.exit(1);
});
