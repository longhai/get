import fs from "fs";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const PLATFORM_ID = 7; // NES
const PLATFORM_NAME = "Nintendo Entertainment System (NES)";
const OUTPUT_DIR = "data";
const OUTPUT_FILE = `${OUTPUT_DIR}/${PLATFORM_NAME}.csv`;
const BASE_LIST_URL = "https://thegamesdb.net/list_games.php";
const BASE_GAME_URL = "https://thegamesdb.net/game.php";

// Tạo thư mục nếu chưa có
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

// Hàm lấy danh sách id game trên 1 trang
async function getGameIds(page = 1) {
  const url = `${BASE_LIST_URL}?platform_id=${PLATFORM_ID}&page=${page}`;
  console.log(`🔹 Fetching list page ${page}`);
  const res = await fetch(url);
  const html = await res.text();
  const $ = cheerio.load(html);

  const ids = $("div.card.border-primary a")
    .map((_, el) => {
      const href = $(el).attr("href");
      const match = href?.match(/id=(\d+)/);
      return match ? match[1] : null;
    })
    .get()
    .filter(Boolean);

  // Kiểm tra có nút Next không
  const hasNext = $("a.page-link:contains('Next')").length > 0;

  return { ids, hasNext };
}

// Hàm scrape chi tiết 1 game theo id
async function scrapeGame(id) {
  const url = `${BASE_GAME_URL}?id=${id}`;
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

// Main: scrape tất cả game NES
async function main() {
  let allGames = [];
  let page = 1;

  while (true) {
    const { ids, hasNext } = await getGameIds(page);
    if (ids.length === 0) break;

    for (const id of ids) {
      try {
        console.log(`📥 Scraping game ID ${id}`);
        const game = await scrapeGame(id);
        allGames.push(game);
      } catch (err) {
        console.error(`❌ Failed to scrape game ID ${id}:`, err);
      }
    }

    if (!hasNext) break;
    page++;
  }

  // Ghi CSV
  const csvHeader = "title,also_known_as,release_date,region,country,developers,publishers,players,co_op,esrb,genres,overview\n";
  const csvData = allGames
    .map(game => [
      game.title, game.alsoKnownAs, game.releaseDate, game.region, game.country,
      game.developers, game.publishers, game.players, game.coop, game.esrb, game.genres, game.overview
    ].map(x => `"${x.replace(/"/g, '""')}"`).join(","))
    .join("\n");

  fs.writeFileSync(OUTPUT_FILE, csvHeader + csvData);
  console.log(`✅ Saved ${allGames.length} games to ${OUTPUT_FILE}`);
}

main();
