import fs from "fs";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const BASE_LIST_URL = "https://thegamesdb.net/list_games.php";
const BASE_GAME_URL = "https://thegamesdb.net/game.php";
const PLATFORM_ID = 7; // NES
const OUTPUT_DIR = "data";
const OUTPUT_FILE = `${OUTPUT_DIR}/nes_games.csv`;
const CONCURRENCY = 5; // Số lượng game xử lý song song mỗi lần

// Lấy danh sách game IDs từ trang list_games.php
async function getGameIds(platformId) {
  let page = 1;
  const ids = [];

  while (true) {
    const url = `${BASE_LIST_URL}?platform_id=${platformId}&page=${page}`;
    console.log(`🔹 Fetching list page ${page}...`);
    const res = await fetch(url);
    const html = await res.text();
    const $ = cheerio.load(html);

    const cards = $("div.card.border-primary");
    if (cards.length === 0) break;

    cards.each((_, el) => {
      const href = $(el).find("a").attr("href") || "";
      const match = href.match(/id=(\d+)/);
      if (match) ids.push(match[1]);
    });

    const hasNext = $("a.page-link:contains('Next')").length > 0;
    if (!hasNext) break;
    page++;
  }

  return ids;
}

// Lấy chi tiết từng game từ game.php?id=
async function scrapeGame(id) {
  const url = `${BASE_GAME_URL}?id=${id}`;
  try {
    const res = await fetch(url);
    const html = await res.text();
    const $ = cheerio.load(html);

    const getText = (selector) => $(selector).first().text().trim() || "";

    const title = getText("div.card-header h1");
    const alias = getText("div.card-header h6").replace("Also know as:", "").trim();
    const platform = $("p:contains('Platform') a").first().text().trim();
    const region = $("p:contains('Region')").first().text().replace("Region:", "").trim();
    const country = $("p:contains('Country')").first().text().replace("Country:", "").trim();
    const developers = $("p:contains('Developer') a").map((i, el) => $(el).text().trim()).get().join("|");
    const publishers = $("p:contains('Publisher') a").map((i, el) => $(el).text().trim()).get().join("|");
    const releaseDate = $("p:contains('ReleaseDate')").first().text().replace("ReleaseDate:", "").trim();
    const players = $("p:contains('Players')").first().text().replace("Players:", "").trim();
    const coOp = $("p:contains('Co-op')").first().text().replace("Co-op:", "").trim();
    const overview = $("p.game-overview").first().text().trim();
    const esrb = $("p:contains('ESRB Rating')").first().text().replace("ESRB Rating:", "").trim();
    const genres = $("p:contains('Genre')").first().text().replace("Genre(s):", "").trim();

    // CSV chỉ lấy dữ liệu text, bỏ id và ảnh
    return { title, alias, platform, region, country, developers, publishers, releaseDate, players, coOp, overview, esrb, genres };
  } catch (err) {
    console.error(`❌ Error fetching game ${id}:`, err.message);
    return null;
  }
}

// Chạy song song batch
async function scrapeAll(ids) {
  const results = [];
  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    const batch = ids.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(batch.map(scrapeGame));
    results.push(...batchResults.filter(r => r !== null));
  }
  return results;
}

async function main() {
  console.log("📥 Scraping started...");
  const ids = await getGameIds(PLATFORM_ID);
  console.log(`📌 Found ${ids.length} game IDs.`);

  const games = await scrapeAll(ids);

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

  const csvHeader = "title,alias,platform,region,country,developers,publishers,releaseDate,players,coOp,overview,esrb,genres\n";
  const csvData = games
    .map(g => Object.values(g)
      .map(x => `"${(x||"").replace(/"/g, '""')}"`)
      .join(","))
    .join("\n");

  fs.writeFileSync(OUTPUT_FILE, csvHeader + csvData);
  console.log(`✅ Saved ${games.length} games to ${OUTPUT_FILE}`);
}

main().catch(err => {
  console.error("❌ Error:", err);
  process.exit(1);
});
