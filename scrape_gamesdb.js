import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const PLATFORM_ID = 7; // NES
const BASE_URL = `https://thegamesdb.net/list_games.php?platform_id=${PLATFORM_ID}`;
const OUTPUT_DIR = "data";
const OUTPUT_FILE = path.join(OUTPUT_DIR, `NES_games.csv`);
const CONCURRENCY = 5;

async function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// 🟩 Lấy danh sách tất cả game (dò tự động tất cả trang)
async function getGameList() {
  let page = 1;
  const games = [];

  while (true) {
    const url = `${BASE_URL}&page=${page}`;
    log(`→ Fetch list page ${page}: ${url}`);
    const res = await fetch(url);
    if (!res.ok) break;

    const html = await res.text();
    const $ = cheerio.load(html);

    const cards = $(".card.border-primary");
    if (!cards.length) break;

    cards.each((_, el) => {
      const title = $(el).find(".card-header a").text().trim();
      const href = $(el).find(".card-header a").attr("href");
      if (title && href) {
        const gameUrl = new URL(href, "https://thegamesdb.net/").href;
        games.push({ title, url: gameUrl });
      }
    });

    const hasNext = $(".page-link").filter((_, el) => $(el).text().trim() === "Next").length > 0;
    if (!hasNext) break;

    page++;
    await delay(1000);
  }

  return games;
}

// 🟦 Lấy chi tiết từng game
async function getGameDetails(game) {
  try {
    const res = await fetch(game.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const $ = cheerio.load(html);

    const getText = (label) =>
      $(`p:contains('${label}')`).text().replace(label, "").trim() || "";

    const data = {
      Title: $("h1").first().text().trim() || game.title,
      Platform: getText("Platform:"),
      Region: getText("Region:"),
      Country: getText("Country:"),
      Developer: getText("Developer:"),
      Publisher: getText("Publisher:"),
      ReleaseDate: getText("Release Date:"),
      Players: getText("Players:"),
      Coop: getText("Co-op:"),
      Genre: getText("Genre(s):"),
      Overview: $(".game-overview").text().trim(),
      URL: game.url,
    };

    // Nếu không có Platform thì coi như fail
    if (!data.Platform) {
      log(`⚠️ ${game.title} không có dữ liệu chi tiết.`);
      return null;
    }

    return data;
  } catch (err) {
    log(`❌ Error fetching ${game.title}: ${err.message}`);
    return null;
  }
}

// 🟨 Chuyển dữ liệu sang CSV
function toCSV(data) {
  if (!data.length) return "";
  const headers = Object.keys(data[0]);
  const lines = [headers.join(",")];
  for (const row of data) {
    const vals = headers.map((h) => `"${String(row[h] || "").replace(/"/g, '""')}"`);
    lines.push(vals.join(","));
  }
  return lines.join("\n");
}

// 🟧 Xử lý song song (hạn chế requests)
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

// 🟥 Main
async function main() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  log("🔧 Bắt đầu quét danh sách game NES...");
  const games = await getGameList();
  log(`📜 Tổng cộng ${games.length} game được tìm thấy.`);

  if (!games.length) {
    fs.writeFileSync(OUTPUT_FILE, "No games found\n");
    log("⚠️ Không có game nào được lấy.");
    return;
  }

  const results = await processQueue(games, CONCURRENCY, async (g, i) => {
    log(`→ [${i + 1}/${games.length}] ${g.title}`);
    return await getGameDetails(g);
  });

  const valid = results.filter(Boolean);
  if (!valid.length) {
    fs.writeFileSync(OUTPUT_FILE, "No data parsed\n");
    log("⚠️ Không có dữ liệu hợp lệ được trích xuất.");
    return;
  }

  const csv = toCSV(valid);
  fs.writeFileSync(OUTPUT_FILE, csv);
  log(`✅ Đã lưu ${valid.length} game vào ${OUTPUT_FILE}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
