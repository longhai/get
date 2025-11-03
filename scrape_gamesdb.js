import fs from "fs";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const PLATFORM_ID = 7; // NES
const PLATFORM_NAME = "Nintendo Entertainment System (NES)";
const BASE_URL = `https://thegamesdb.net/list_games.php?platform_id=${PLATFORM_ID}`;
const OUTPUT_DIR = "data";
const IDS_FILE = `${OUTPUT_DIR}/list_game_ids.json`;
const OUTPUT_FILE = `${OUTPUT_DIR}/${PLATFORM_NAME}.csv`;

const CONCURRENCY = 5;
const DELAY_MS = 300; // nghỉ nhẹ giữa các batch tránh bị chặn

// ========== LẤY DANH SÁCH GAME TOÀN TRANG ==========
async function getAllGameIds() {
  let pageUrl = BASE_URL;
  const allIds = new Set();

  console.log("📥 Đang quét danh sách game từ nhiều trang...");

  while (true) {
    const res = await fetch(pageUrl);
    const html = await res.text();
    const $ = cheerio.load(html);

    $("a[href*='game.php?id=']").each((_, el) => {
      const href = $(el).attr("href");
      const match = href.match(/game\.php\?id=(\d+)/);
      if (match) allIds.add(match[1]);
    });

    const nextLink = $("a.page-link:contains('Next')").attr("href");
    if (!nextLink || nextLink.includes("#")) {
      console.log("🚫 Hết trang, không còn Next.");
      break;
    }

    pageUrl = "https://thegamesdb.net/" + nextLink.replace("&amp;", "&");
    console.log("➡️ Chuyển sang:", pageUrl);
    await new Promise(r => setTimeout(r, 200)); // nghỉ nhẹ giữa các trang
  }

  return [...allIds];
}

// ========== SCRAPE CHI TIẾT MỘT GAME ==========
async function scrapeGame(id) {
  const url = `https://thegamesdb.net/game.php?id=${id}`;
  const res = await fetch(url);
  const html = await res.text();
  const $ = cheerio.load(html);

  const header = $("div.card-header").first();
  const title = header.find("h1").text().trim();

  let alsoKnownAs = header.find("h6.text-muted").text().replace("Also know as:", "").trim();
  if (alsoKnownAs.includes("|")) alsoKnownAs = alsoKnownAs.split("|")[0].trim();

  const overview = $("p.game-overview").text().replace(/\s+/g, " ").trim();
  const esrb = $("div.card-body p:contains('ESRB Rating:')").text().replace("ESRB Rating:", "").trim();
  const genres = $("div.card-body p:contains('Genre(s):')").text().replace("Genre(s):", "").trim();
  const region = $("div.card-body p:contains('Region:')").text().replace("Region:", "").trim();
  const country = $("div.card-body p:contains('Country:')").text().replace("Country:", "").trim();
  const developers = $("div.card-body p:contains('Developer') a").map((_, el) => $(el).text().trim()).get().join("; ");
  const publishers = $("div.card-body p:contains('Publisher') a").map((_, el) => $(el).text().trim()).get().join("; ");
  const releaseDate = $("div.card-body p:contains('ReleaseDate:')").text().replace("ReleaseDate:", "").trim();
  const players = $("div.card-body p:contains('Players:')").text().replace("Players:", "").trim();
  const coop = $("div.card-body p:contains('Co-op:')").text().replace("Co-op:", "").trim();

  return { id, title, alsoKnownAs, releaseDate, region, country, developers, publishers, players, coop, esrb, genres, overview };
}

// ========== GHI CSV ==========
function appendCsv(game) {
  const csvData = [
    game.title,
    game.alsoKnownAs,
    game.releaseDate,
    game.region,
    game.country,
    game.developers,
    game.publishers,
    game.players,
    game.coop,
    game.esrb,
    game.genres,
    game.overview
  ].map(x => `"${(x || "").replace(/"/g, '""')}"`).join(",");

  fs.appendFileSync(OUTPUT_FILE, csvData + "\n");
}

// ========== MAIN ==========
async function main() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

  let gameIds = [];
  if (fs.existsSync(IDS_FILE)) {
    console.log("💾 Đọc cache ID từ", IDS_FILE);
    gameIds = JSON.parse(fs.readFileSync(IDS_FILE, "utf-8"));
  } else {
    gameIds = await getAllGameIds();
    fs.writeFileSync(IDS_FILE, JSON.stringify(gameIds, null, 2));
    console.log(`✅ Đã lưu ${gameIds.length} ID game vào cache.`);
  }

  // Đọc danh sách game đã làm (nếu file CSV tồn tại)
  let doneIds = new Set();
  if (fs.existsSync(OUTPUT_FILE)) {
    const csvData = fs.readFileSync(OUTPUT_FILE, "utf-8");
    for (const id of gameIds) {
      if (csvData.includes(`"${id}"`)) doneIds.add(id);
    }
  } else {
    const csvHeader = "title,also_known_as,release_date,region,country,developers,publishers,players,co_op,esrb,genres,overview\n";
    fs.writeFileSync(OUTPUT_FILE, csvHeader);
  }

  const remainingIds = gameIds.filter(id => !doneIds.has(id));
  console.log(`🎮 Còn lại ${remainingIds.length} / ${gameIds.length} game cần scrape.`);

  // Scrape từng batch
  for (let i = 0; i < remainingIds.length; i += CONCURRENCY) {
    const batch = remainingIds.slice(i, i + CONCURRENCY);
    const games = await Promise.all(batch.map(id => scrapeGame(id)));

    for (const game of games) appendCsv(game);

    console.log(`📦 Đã scrape ${i + batch.length}/${remainingIds.length}`);
    await new Promise(r => setTimeout(r, DELAY_MS));
  }

  console.log(`🎉 Hoàn tất! File CSV lưu tại: ${OUTPUT_FILE}`);
}

main();
