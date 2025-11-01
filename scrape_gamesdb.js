import fs from "fs";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const BASE_URL = "https://thegamesdb.net";
const PLATFORM_ID = 7; // NES
const OUTPUT_DIR = "data";
const OUTPUT_FILE = `${OUTPUT_DIR}/nes_games.csv`;

// Lấy danh sách ID game từ trang list
async function collectAllGameList(platformId) {
  let page = 1;
  let allIds = [];

  while (true) {
    const url = `${BASE_URL}/list_games.php?platform_id=${platformId}&page=${page}`;
    console.log(`→ Fetch list page ${page}: ${url}`);

    const res = await fetch(url);
    const html = await res.text();
    const $ = cheerio.load(html); // ✅ dùng cheerio.load

    const ids = $("a[href*='game.php?id=']")
      .map((_, el) => {
        const match = $(el).attr("href")?.match(/id=(\d+)/);
        return match ? match[1] : null;
      })
      .get()
      .filter(Boolean);

    if (ids.length === 0) break;
    allIds.push(...ids);

    const hasNext = $("a.page-link:contains('Next')").length > 0;
    if (!hasNext) break;
    page++;
  }

  return [...new Set(allIds)];
}

// Lấy thông tin chi tiết từng game
async function getGameDetail(id) {
  const url = `${BASE_URL}/game.php?id=${id}`;
  const res = await fetch(url);
  const html = await res.text();
  const $ = cheerio.load(html); // ✅ cũng phải load

  const title = $("h2.card-title").text().trim();
  const developer = $("td:contains('Developer')").next("td").text().trim();
  const publisher = $("td:contains('Publisher')").next("td").text().trim();
  const release = $("td:contains('Release Date')").next("td").text().trim();
  const genre = $("td:contains('Genre')").next("td").text().trim();
  const overview = $("#game_overview").text().trim();
  const img = $(".img-thumbnail").attr("src") || "";

  return { id, title, developer, publisher, release, genre, overview, img };
}

async function run() {
  console.log("📥 Collecting all game IDs...");
  const ids = await collectAllGameList(PLATFORM_ID);
  console.log(`✅ Found ${ids.length} games.`);

  const results = [];
  for (const id of ids) {
    try {
      console.log(`→ Fetching game ${id}`);
      const data = await getGameDetail(id);
      results.push(data);
    } catch (e) {
      console.warn(`⚠️ Skipped game ${id}:`, e.message);
    }
  }

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);
  const header = "id,title,developer,publisher,release,genre,overview,image\n";
  const body = results
    .map(g =>
      [
        g.id,
        g.title,
        g.developer,
        g.publisher,
        g.release,
        g.genre,
        g.overview.replace(/\s+/g, " "),
        g.img.startsWith("http") ? g.img : `${BASE_URL}/${g.img}`
      ]
        .map(v => `"${(v || "").replace(/"/g, '""')}"`)
        .join(",")
    )
    .join("\n");

  fs.writeFileSync(OUTPUT_FILE, header + body);
  console.log(`✅ Saved ${results.length} games → ${OUTPUT_FILE}`);
}

run().catch(e => {
  console.error("❌ Fatal error:", e);
  process.exit(1);
});
