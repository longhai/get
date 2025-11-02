import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const PLATFORM_ID = 7; // NES
const BASE_URL = `https://thegamesdb.net/list_games.php?platform_id=${PLATFORM_ID}`;
const OUTPUT_DIR = "data";
const OUTPUT_FILE = path.join(OUTPUT_DIR, `NES_games.csv`);
const CONCURRENCY = 10;

// Helper
async function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// 🔹 Lấy danh sách tất cả game (có nhiều trang)
async function getGameList() {
  let page = 1;
  const games = [];

  while (true) {
    const url = `${BASE_URL}&page=${page}`;
    log(`→ Fetch list page ${page}`);
    const res = await fetch(url);
    if (!res.ok) break;
    const html = await res.text();
    const $ = cheerio.load(html);

    const rows = $(".list_item");
    if (!rows.length) break;

    rows.each((_, el) => {
      const title = $(el).find(".game_title a").text().trim();
      const href = $(el).find(".game_title a").attr("href");
      if (title && href) {
        const gameUrl = new URL(href, "https://thegamesdb.net/").href;
        games.push({ title, url: gameUrl });
      }
    });

    const hasNext = $(".pagination a:contains('Next')").length > 0;
    if (!hasNext) break;

    page++;
    await delay(800);
  }

  return games;
}

// 🔹 Lấy chi tiết từng game
async function getGameDetails(game) {
  try {
    const res = await fetch(game.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const $ = cheerio.load(html);

    const data = {
      Title: $("h1").first().text().trim() || game.title,
      Platform: $("p:contains('Platform:') a").text().trim(),
      Region: $("p:contains('Region:')").text().replace("Region:", "").trim(),
      Country: $("p:contains('Country:')").text().replace("Country:", "").trim(),
      Developer: $("p:contains('Developer') a").map((_, a) => $(a).text().trim()).get().join(", "),
      Publisher: $("p:contains('Publisher') a").map((_, a) => $(a).text().trim()).get().join(", "),
      ReleaseDate: $("p:contains('ReleaseDate:')").text().replace("ReleaseDate:", "").trim(),
      Players: $("p:contains('Players:')").text().replace("Players:", "").trim(),
      Coop: $("p:contains('Co-op:')").text().replace("Co-op:", "").trim(),
      Genre: $("p:contains('Genre')").text().replace("Genre(s):", "").trim(),
      Overview: $(".game-overview").text().trim(),
      URL: game.url,
    };

    return data;
  } catch (err) {
    log(`❌ Error on ${game.title}: ${err.message}`);
    return null;
  }
}

// 🔹 Chuyển dữ liệu sang CSV
function toCSV(data) {
  if (!data.length) return "";
  const headers = Object.keys(data[0]);
  const lines = [headers.join(",")];
  for (const row of data) {
    const values = headers.map(h => `"${String(row[h] || "").replace(/"/g, '""').replace(/\r?\n|\r/g, " ")}"`);
    lines.push(values.join(","));
  }
  return lines.join("\n");
}

// 🔹 Xử lý song song
async function processQueue(items, limit, fn) {
  const results = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      const r = await fn(items[i], i);
      results[i] = r;
      await delay(300);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// 🔹 Main
async function main() {
  log("🔧 Bắt đầu scraper...");

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    log(`📂 Tạo thư mục ${OUTPUT_DIR}`);
  }

  const games = await getGameList();
  log(`🔍 Tổng số game tìm thấy: ${games.length}`);

  if (!games.length) {
    log("⚠️ Không có game nào — có thể selector trang thay đổi.");
    fs.writeFileSync(OUTPUT_FILE, "No data found\n");
    return;
  }

  const results = await processQueue(games, CONCURRENCY, async (g, i) => {
    log(`→ [${i + 1}/${games.length}] ${g.title}`);
    return await getGameDetails(g);
  });

  const valid = results.filter(Boolean);
  const csv = toCSV(valid);

  fs.writeFileSync(OUTPUT_FILE, csv || "No data\n");
  log(`✅ Đã lưu ${valid.length} game vào ${OUTPUT_FILE}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
