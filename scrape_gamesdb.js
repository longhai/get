import fs from "fs";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const PLATFORM_ID = 7; // NES
const LIST_URL = `https://thegamesdb.net/list_games.php?platform_id=${PLATFORM_ID}`;
const OUTPUT_DIR = "data";
const PLATFORM_NAME = "Nintendo Entertainment System (NES)";
const OUTPUT_FILE = `${OUTPUT_DIR}/${PLATFORM_NAME}.csv`;

// Hàm lấy danh sách game với ID
async function getGameIds(url) {
  const res = await fetch(url);
  const html = await res.text();
  const $ = cheerio.load(html);

  // Lấy tất cả link game, ví dụ: game.php?id=29289
  const gameIds = [];
  $("a[href*='game.php?id=']").each((_, el) => {
    const href = $(el).attr("href");
    const match = href.match(/game\.php\?id=(\d+)/);
    if (match) gameIds.push(match[1]);
  });

  // Loại bỏ trùng lặp
  return [...new Set(gameIds)];
}

// Hàm scrape chi tiết 1 game
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

  const esrb = $("div.card-body p")
    .filter((_, el) => $(el).text().trim().startsWith("ESRB Rating:"))
    .text().replace("ESRB Rating:", "").trim();

  const genres = $("div.card-body p")
    .filter((_, el) => $(el).text().trim().startsWith("Genre(s):"))
    .text().replace("Genre(s):", "").trim();

  const region = $("div.card-body p:contains('Region:')").text().replace("Region:", "").trim();
  const country = $("div.card-body p:contains('Country:')").text().replace("Country:", "").trim();
  const developers = $("div.card-body p:contains('Developer') a").map((_, el) => $(el).text().trim()).get().join("; ");
  const publishers = $("div.card-body p:contains('Publisher') a").map((_, el) => $(el).text().trim()).get().join("; ");
  const releaseDate = $("div.card-body p:contains('ReleaseDate:')").text().replace("ReleaseDate:", "").trim();
  const players = $("div.card-body p:contains('Players:')").text().replace("Players:", "").trim();
  const coop = $("div.card-body p:contains('Co-op:')").text().replace("Co-op:", "").trim();

  return { title, alsoKnownAs, releaseDate, region, country, developers, publishers, players, coop, esrb, genres, overview };
}

// Main
async function main() {
  try {
    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

    console.log("📥 Lấy danh sách game...");
    const gameIds = await getGameIds(LIST_URL);
    console.log(`✅ Tìm thấy ${gameIds.length} game.`);

    const csvHeader = "title,also_known_as,release_date,region,country,developers,publishers,players,co_op,esrb,genres,overview\n";
    fs.writeFileSync(OUTPUT_FILE, csvHeader);

    // Scrape nhiều game song song (limit 5 cùng lúc để tránh bị block)
    const CONCURRENCY = 5;
    for (let i = 0; i < gameIds.length; i += CONCURRENCY) {
      const batch = gameIds.slice(i, i + CONCURRENCY);
      const games = await Promise.all(batch.map(id => scrapeGame(id)));

      for (const game of games) {
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
        ].map(x => `"${x.replace(/"/g, '""')}"`).join(",");

        fs.appendFileSync(OUTPUT_FILE, csvData + "\n");
      }

      console.log(`📦 Đã scrape batch ${i + 1} → ${i + batch.length}`);
    }

    console.log(`✅ Hoàn tất, lưu CSV tại ${OUTPUT_FILE}`);
  } catch (err) {
    console.error("❌ Error:", err);
  }
}

main();
