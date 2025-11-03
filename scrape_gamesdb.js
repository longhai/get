import fs from "fs";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const PLATFORM_ID = 7; // NES
const BASE_URL = "https://thegamesdb.net";

// ==== Hàm lấy tên platform và toàn bộ ID game ====
async function getAllGameIds(platformId) {
  let nextUrl = `${BASE_URL}/list_games.php?platform_id=${platformId}`;
  const gameIds = new Set();
  let platformName = "Unknown Platform";

  console.log(`📥 Đang lấy danh sách game cho platform_id=${platformId}...`);

  while (nextUrl) {
    const res = await fetch(nextUrl);
    const html = await res.text();
    const $ = cheerio.load(html);

    // Lấy tên platform nếu có
    const platformHeader = $("h1").first().text().trim();
    if (platformHeader) platformName = platformHeader;

    // Lấy tất cả ID game
    $("a[href*='game.php?id=']").each((_, el) => {
      const href = $(el).attr("href");
      const match = href.match(/game\.php\?id=(\d+)/);
      if (match) gameIds.add(match[1]);
    });

    // Tìm nút "Next"
    const nextLink = $("a.page-link:contains('Next')");
    if (nextLink.length > 0) {
      const href = nextLink.attr("href");
      nextUrl = href ? `${BASE_URL}/${href}` : null;
      console.log(`➡️ Sang trang tiếp: ${nextUrl}`);
    } else {
      nextUrl = null;
    }
  }

  console.log(`✅ Tổng cộng ${gameIds.size} game được tìm thấy cho ${platformName}`);
  return { platformName, gameIds: Array.from(gameIds) };
}

// ==== Hàm scrape chi tiết từng game ====
async function scrapeGame(id) {
  const url = `${BASE_URL}/game.php?id=${id}`;
  try {
    const res = await fetch(url);
    const html = await res.text();
    const $ = cheerio.load(html);

    const header = $("div.card-header").first();

    const title = header.find("h1").text().trim();

    let alsoKnownAs = header.find("h6.text-muted").text().replace("Also know as:", "").trim();
    if (alsoKnownAs.includes("|")) alsoKnownAs = alsoKnownAs.split("|")[0].trim();

    const overview = $("p.game-overview").text().replace(/\s+/g, " ").trim();
    const esrb = $("div.card-body p").filter((_, el) => $(el).text().trim().startsWith("ESRB Rating:")).text().replace("ESRB Rating:", "").trim();
    const genres = $("div.card-body p").filter((_, el) => $(el).text().trim().startsWith("Genre(s):")).text().replace("Genre(s):", "").trim();
    const region = $("div.card-body p:contains('Region:')").text().replace("Region:", "").trim();
    const country = $("div.card-body p:contains('Country:')").text().replace("Country:", "").trim();
    const developers = $("div.card-body p:contains('Developer') a").map((_, el) => $(el).text().trim()).get().join("; ");
    const publishers = $("div.card-body p:contains('Publisher') a").map((_, el) => $(el).text().trim()).get().join("; ");
    const releaseDate = $("div.card-body p:contains('ReleaseDate:')").text().replace("ReleaseDate:", "").trim();
    const players = $("div.card-body p:contains('Players:')").text().replace("Players:", "").trim();
    const coop = $("div.card-body p:contains('Co-op:')").text().replace("Co-op:", "").trim();

    return { id, title, alsoKnownAs, releaseDate, region, country, developers, publishers, players, coop, esrb, genres, overview };
  } catch (err) {
    console.error(`⚠️ Lỗi scrape game ID ${id}: ${err.message}`);
    return null;
  }
}

// ==== Ghi 1 dòng CSV ====
function writeCsvLine(file, game) {
  const csvLine = [
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
  fs.appendFileSync(file, csvLine + "\n");
}

// ==== Main ====
async function main() {
  const { platformName, gameIds } = await getAllGameIds(PLATFORM_ID);

  const OUTPUT_DIR = "data";
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);
  const OUTPUT_FILE = `${OUTPUT_DIR}/${platformName.replace(/[<>:"/\\|?*]+/g, "_")}.csv`;

  const header = "title,also_known_as,release_date,region,country,developers,publishers,players,co_op,esrb,genres,overview\n";
  fs.writeFileSync(OUTPUT_FILE, header);

  console.log(`🚀 Bắt đầu scrape ${gameIds.length} game...`);
  const CONCURRENCY = 10; // số lượng scrape song song
  let done = 0;

  // Bộ nhớ tạm: nếu dừng giữa chừng, có thể chạy lại và skip những game đã có
  const TEMP_FILE = `${OUTPUT_FILE}.done.json`;
  let doneIds = [];
  if (fs.existsSync(TEMP_FILE)) {
    doneIds = JSON.parse(fs.readFileSync(TEMP_FILE, "utf-8"));
    console.log(`🔁 Tiếp tục từ lần trước, đã hoàn thành ${doneIds.length} game.`);
  }

  const remainingIds = gameIds.filter(id => !doneIds.includes(id));

  for (let i = 0; i < remainingIds.length; i += CONCURRENCY) {
    const batch = remainingIds.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(scrapeGame));

    for (const game of results.filter(Boolean)) {
      writeCsvLine(OUTPUT_FILE, game);
      doneIds.push(game.id);
      done++;
    }

    // Cập nhật file tạm mỗi batch
    fs.writeFileSync(TEMP_FILE, JSON.stringify(doneIds));

    console.log(`📦 Đã xử lý ${done}/${gameIds.length} game (${Math.round((done / gameIds.length) * 100)}%)`);
  }

  console.log(`✅ Hoàn tất. Dữ liệu lưu tại: ${OUTPUT_FILE}`);
  fs.unlinkSync(TEMP_FILE); // Xóa file tạm khi hoàn tất
}

main().catch(console.error);
