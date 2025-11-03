import fs from "fs";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const BASE_URL = "https://thegamesdb.net";
const PLATFORM_ID = 7;

// ===== LẤY DANH SÁCH GAME =====
async function getAllGameIds(platformId) {
  let nextUrl = `${BASE_URL}/list_games.php?platform_id=${platformId}`;
  const gameIds = new Set();
  let platformName = "Unknown Platform";
  let page = 1;

  console.log(`📥 Lấy danh sách game platform_id=${platformId}...`);

  while (nextUrl) {
    console.log(`🔎 Trang ${page}: ${nextUrl}`);
    const res = await fetch(nextUrl);
    const html = await res.text();
    const $ = cheerio.load(html);

    const header = $("h1").first().text().trim();
    if (header) platformName = header;

    $("a[href*='game.php?id=']").each((_, el) => {
      const href = $(el).attr("href");
      const match = href.match(/game\.php\?id=(\d+)/);
      if (match) gameIds.add(match[1]);
    });

    const nextLink = $("a.page-link:contains('Next')");
    if (nextLink.length > 0) {
      const href = nextLink.attr("href");
      if (href && href !== "#") {
        nextUrl = href.startsWith("http")
          ? href
          : `${BASE_URL}/${href.replace(/^\/+/, "")}`;
        page++;
      } else nextUrl = null;
    } else nextUrl = null;
  }

  console.log(`✅ ${gameIds.size} game (${page} trang) cho ${platformName}`);
  return { platformName, gameIds: Array.from(gameIds) };
}

// ===== SCRAPE 1 GAME =====
async function scrapeGame(id) {
  const url = `${BASE_URL}/game.php?id=${id}`;
  try {
    const res = await fetch(url);
    const html = await res.text();
    const $ = cheerio.load(html);
    const header = $("div.card-header").first();
    const title = header.find("h1").text().trim();

    if (!title) throw new Error("Không tìm thấy tiêu đề game!");

    let alsoKnownAs = header.find("h6.text-muted").text().replace("Also know as:", "").trim();
    if (alsoKnownAs.includes("|")) alsoKnownAs = alsoKnownAs.split("|")[0].trim();

    const overview = $("p.game-overview").text().replace(/\s+/g, " ").trim();
    const esrb = $("div.card-body p").filter((_, el) => $(el).text().trim().startsWith("ESRB Rating:"))
      .text().replace("ESRB Rating:", "").trim();
    const genres = $("div.card-body p").filter((_, el) => $(el).text().trim().startsWith("Genre(s):"))
      .text().replace("Genre(s):", "").trim();
    const region = $("div.card-body p:contains('Region:')").text().replace("Region:", "").trim();
    const country = $("div.card-body p:contains('Country:')").text().replace("Country:", "").trim();
    const developers = $("div.card-body p:contains('Developer') a").map((_, el) => $(el).text().trim()).get().join("; ");
    const publishers = $("div.card-body p:contains('Publisher') a").map((_, el) => $(el).text().trim()).get().join("; ");
    const releaseDate = $("div.card-body p:contains('ReleaseDate:')").text().replace("ReleaseDate:", "").trim();
    const players = $("div.card-body p:contains('Players:')").text().replace("Players:", "").trim();
    const coop = $("div.card-body p:contains('Co-op:')").text().replace("Co-op:", "").trim();

    return { id, title, alsoKnownAs, releaseDate, region, country, developers, publishers, players, coop, esrb, genres, overview };
  } catch (err) {
    console.error(`⚠️ Lỗi scrape ${id}: ${err.message}`);
    return null;
  }
}

// ===== GHI 1 DÒNG CSV =====
function writeCsvLine(file, game) {
  const line = [
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
  fs.appendFileSync(file, line + "\n");
}

// ===== MAIN =====
async function main() {
  const { platformName, gameIds } = await getAllGameIds(PLATFORM_ID);

  const dir = "data";
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);

  const safeName = platformName.replace(/[<>:"/\\|?*]+/g, "_");
  const csvFile = `${dir}/${safeName}.csv`;
  const cacheFile = `${csvFile}.done.json`;

  console.log(`🗂️ File CSV: ${csvFile}`);
  fs.writeFileSync(csvFile, "title,also_known_as,release_date,region,country,developers,publishers,players,co_op,esrb,genres,overview\n");
  fs.writeFileSync(cacheFile, "[]"); // tạo cache rỗng ngay từ đầu
  console.log("✅ Đã tạo file CSV và cache rỗng.");

  const CONCURRENCY = 10;
  let doneIds = [];

  for (let i = 0; i < gameIds.length; i += CONCURRENCY) {
    const batch = gameIds.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(scrapeGame));

    for (const game of results.filter(Boolean)) {
      writeCsvLine(csvFile, game);
      doneIds.push(game.id);
      console.log(`💾 Ghi xong: ${game.title}`);
    }

    fs.writeFileSync(cacheFile, JSON.stringify(doneIds));
    console.log(`📦 Batch ${i + 1}/${gameIds.length} — ${doneIds.length} game đã lưu`);
  }

  console.log("✅ Hoàn tất! Kiểm tra thư mục /data để xem file CSV.");
}

main().catch(err => console.error("❌ Lỗi chính:", err));
