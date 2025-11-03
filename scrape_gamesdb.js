import fs from "fs";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const BASE_URL = "https://thegamesdb.net";
const PLATFORM_ID = 7; // NES – có thể đổi thành platform khác

// ======= LẤY DANH SÁCH TOÀN BỘ GAME THEO PLATFORM (CÓ PHÂN TRANG) =======
async function getAllGameIds(platformId) {
  let nextUrl = `${BASE_URL}/list_games.php?platform_id=${platformId}`;
  const gameIds = new Set();
  let platformName = "Unknown Platform";
  let page = 1;

  console.log(`📥 Đang lấy danh sách game cho platform_id=${platformId}...`);

  while (nextUrl) {
    console.log(`🔎 Trang ${page}: ${nextUrl}`);
    const res = await fetch(nextUrl);
    const html = await res.text();
    const $ = cheerio.load(html);

    // Lấy tên platform
    const header = $("h1").first().text().trim();
    if (header) platformName = header;

    // Lấy ID game từ link
    $("a[href*='game.php?id=']").each((_, el) => {
      const href = $(el).attr("href");
      const match = href.match(/game\.php\?id=(\d+)/);
      if (match) gameIds.add(match[1]);
    });

    // Kiểm tra nút Next
    const nextLink = $("a.page-link:contains('Next')");
    if (nextLink.length > 0) {
      const href = nextLink.attr("href");
      if (href && href !== "#") {
        nextUrl = href.startsWith("http")
          ? href
          : `${BASE_URL}/${href.replace(/^\/+/, "")}`;
        page++;
      } else {
        nextUrl = null; // Hết Next
      }
    } else {
      nextUrl = null; // Không có nút Next
    }
  }

  console.log(`✅ Tìm thấy ${gameIds.size} game (${page} trang) cho ${platformName}`);
  return { platformName, gameIds: Array.from(gameIds) };
}

// ======= SCRAPE THÔNG TIN 1 GAME =======
async function scrapeGame(id) {
  const url = `${BASE_URL}/game.php?id=${id}`;
  try {
    const res = await fetch(url);
    const html = await res.text();
    const $ = cheerio.load(html);

    const header = $("div.card-header").first();
    const title = header.find("h1").text().trim();
    let alsoKnownAs = header
      .find("h6.text-muted")
      .text()
      .replace("Also know as:", "")
      .trim();
    if (alsoKnownAs.includes("|"))
      alsoKnownAs = alsoKnownAs.split("|")[0].trim();

    const overview = $("p.game-overview").text().replace(/\s+/g, " ").trim();
    const esrb = $("div.card-body p")
      .filter((_, el) => $(el).text().trim().startsWith("ESRB Rating:"))
      .text()
      .replace("ESRB Rating:", "")
      .trim();
    const genres = $("div.card-body p")
      .filter((_, el) => $(el).text().trim().startsWith("Genre(s):"))
      .text()
      .replace("Genre(s):", "")
      .trim();
    const region = $("div.card-body p:contains('Region:')")
      .text()
      .replace("Region:", "")
      .trim();
    const country = $("div.card-body p:contains('Country:')")
      .text()
      .replace("Country:", "")
      .trim();
    const developers = $("div.card-body p:contains('Developer') a")
      .map((_, el) => $(el).text().trim())
      .get()
      .join("; ");
    const publishers = $("div.card-body p:contains('Publisher') a")
      .map((_, el) => $(el).text().trim())
      .get()
      .join("; ");
    const releaseDate = $("div.card-body p:contains('ReleaseDate:')")
      .text()
      .replace("ReleaseDate:", "")
      .trim();
    const players = $("div.card-body p:contains('Players:')")
      .text()
      .replace("Players:", "")
      .trim();
    const coop = $("div.card-body p:contains('Co-op:')")
      .text()
      .replace("Co-op:", "")
      .trim();

    return {
      id,
      title,
      alsoKnownAs,
      releaseDate,
      region,
      country,
      developers,
      publishers,
      players,
      coop,
      esrb,
      genres,
      overview,
    };
  } catch (err) {
    console.error(`⚠️ Lỗi scrape game ID ${id}: ${err.message}`);
    return null;
  }
}

// ======= GHI 1 DÒNG CSV =======
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
    game.overview,
  ]
    .map((x) => `"${(x || "").replace(/"/g, '""')}"`)
    .join(",");
  fs.appendFileSync(file, csvLine + "\n");
}

// ======= MAIN =======
async function main() {
  const { platformName, gameIds } = await getAllGameIds(PLATFORM_ID);

  const OUTPUT_DIR = "data";
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

  const OUTPUT_FILE = `${OUTPUT_DIR}/${platformName.replace(
    /[<>:"/\\|?*]+/g,
    "_"
  )}.csv`;
  const TEMP_FILE = `${OUTPUT_FILE}.done.json`;

  const header =
    "title,also_known_as,release_date,region,country,developers,publishers,players,co_op,esrb,genres,overview\n";
  fs.writeFileSync(OUTPUT_FILE, header);

  // Bộ nhớ tạm
  let doneIds = [];
  if (fs.existsSync(TEMP_FILE)) {
    doneIds = JSON.parse(fs.readFileSync(TEMP_FILE, "utf-8"));
    console.log(`🔁 Tiếp tục từ lần trước (${doneIds.length} game đã xong).`);
  }

  const remainingIds = gameIds.filter((id) => !doneIds.includes(id));

  console.log(`🚀 Bắt đầu scrape ${remainingIds.length} game...`);
  const CONCURRENCY = 10; // số lượng game xử lý song song
  let done = doneIds.length;

  for (let i = 0; i < remainingIds.length; i += CONCURRENCY) {
    const batch = remainingIds.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(scrapeGame));

    for (const game of results.filter(Boolean)) {
      writeCsvLine(OUTPUT_FILE, game);
      doneIds.push(game.id);
      done++;
    }

    fs.writeFileSync(TEMP_FILE, JSON.stringify(doneIds));
    console.log(
      `📦 Đã xử lý ${done}/${gameIds.length} game (${Math.round(
        (done / gameIds.length) * 100
      )}%)`
    );
  }

  fs.unlinkSync(TEMP_FILE); // Xóa file tạm khi hoàn tất
  console.log(`✅ Hoàn tất! Dữ liệu lưu tại: ${OUTPUT_FILE}`);
}

main().catch(console.error);
