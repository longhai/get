import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const PLATFORM_ID = 7; // NES
const BASE_URL = `https://thegamesdb.net/list_games.php?platform_id=${PLATFORM_ID}`;
const OUTPUT_DIR = "data";
const OUTPUT_FILE = path.join(OUTPUT_DIR, `NES_games.csv`);
const CONCURRENCY = 8;

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------
// 🟢 Lấy danh sách game
// ------------------
async function getGameList() {
  let page = 1;
  const games = [];

  while (true) {
    const url = `${BASE_URL}&page=${page}`;
    log(`→ Đang tải danh sách trang ${page}...`);
    const res = await fetch(url);
    if (!res.ok) break;
    const html = await res.text();
    const $ = cheerio.load(html);

    // Mỗi game nằm trong thẻ .card.border-primary
    const cards = $(".card.border-primary");
    if (!cards.length) break;

    cards.each((_, el) => {
      const title = $(el).find(".card-footer p").first().text().trim();
      const href = $(el).find("a").attr("href");
      if (title && href) {
        const gameUrl = new URL(href, "https://thegamesdb.net/").href;
        games.push({ title, url: gameUrl });
      }
    });

    const next = $("a.page-link:contains('Next')").length > 0;
    if (!next) break;
    page++;
    await delay(500);
  }

  log(`🔍 Tìm thấy tổng cộng ${games.length} game`);
  return games;
}

// ------------------
// 🟢 Lấy thông tin chi tiết từng game
// ------------------
async function getGameDetails(game) {
  try {
    const res = await fetch(game.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const $ = cheerio.load(html);

    const detailBox = $(".card-body");
    const info = {
      Title: $("h1").first().text().trim() || game.title,
      Platform: $("p:contains('Platform:')").text().replace("Platform:", "").trim(),
      Developer: $("p:contains('Developer:')").text().replace("Developer:", "").trim(),
      Publisher: $("p:contains('Publisher:')").text().replace("Publisher:", "").trim(),
      Genre: $("p:contains('Genre(s):')").text().replace("Genre(s):", "").trim(),
      Players: $("p:contains('Players:')").text().replace("Players:", "").trim(),
      Coop: $("p:contains('Co-op:')").text().replace("Co-op:", "").trim(),
      ReleaseDate: $("p:contains('ReleaseDate:')").text().replace("ReleaseDate:", "").trim(),
      Region: $("p:contains('Region:')").text().replace("Region:", "").trim(),
      Country: $("p:contains('Country:')").text().replace("Country:", "").trim(),
      Overview: $(".game-overview").text().trim(),
      URL: game.url,
    };

    // Loại bỏ rỗng
    for (const [k, v] of Object.entries(info)) {
      if (typeof v === "string") info[k] = v.replace(/\s+/g, " ").trim();
    }

    return info;
  } catch (e) {
    log(`❌ Lỗi khi lấy ${game.title}: ${e.message}`);
    return null;
  }
}

// ------------------
// 🟢 Hàm hỗ trợ song song
// ------------------
async function processQueue(items, limit, fn) {
  const results = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i], i);
      await delay(400);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// ------------------
// 🟢 Xuất CSV
// ------------------
function toCSV(data) {
  if (!data.length) return "";
  const headers = Object.keys(data[0]);
  const rows = data.map((row) =>
    headers.map((h) => `"${String(row[h] || "").replace(/"/g, '""')}"`).join(",")
  );
  return [headers.join(","), ...rows].join("\n");
}

// ------------------
// 🟢 Main
// ------------------
async function main() {
  log("🚀 Bắt đầu quét dữ liệu NES...");

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const games = await getGameList();
  if (!games.length) {
    log("⚠️ Không tìm thấy game nào!");
    return;
  }

  const details = await processQueue(games, CONCURRENCY, async (g, i) => {
    log(`→ [${i + 1}/${games.length}] ${g.title}`);
    return await getGameDetails(g);
  });

  const valid = details.filter(Boolean);
  if (!valid.length) {
    log("⚠️ Không lấy được chi tiết nào, có thể bị chặn hoặc selector sai!");
    return;
  }

  // Ghi file CSV
  const csv = toCSV(valid);
  fs.writeFileSync(OUTPUT_FILE, csv);
  log(`✅ Hoàn tất: Lưu ${valid.length} game vào ${OUTPUT_FILE}`);
  console.log("Ví dụ:", valid.slice(0, 3));
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
