// ======== scrape_gamesdb.js ========
// Node.js 18+ (ESM), chạy được trực tiếp trên GitHub Actions

import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const PLATFORM_ID = 7; // NES
const BASE_URL = `https://thegamesdb.net/list_games.php?platform_id=${PLATFORM_ID}`;
const OUTPUT_DIR = "data";
const OUTPUT_FILE = path.join(OUTPUT_DIR, `NES_games.csv`);

async function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Ghi log kèm timestamp
function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// Lấy danh sách game theo từng trang
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
    const rows = $(".list_item");

    if (!rows.length) break; // hết trang

    rows.each((_, el) => {
      const title = $(el).find(".game_title a").text().trim();
      const link = $(el).find(".game_title a").attr("href");
      if (title && link) {
        const gameUrl = new URL(link, "https://thegamesdb.net/").href;
        games.push({ title, url: gameUrl });
      }
    });

    const nextDisabled = $(".pagination .disabled:contains('Next')").length > 0;
    if (nextDisabled) break;

    page++;
    await delay(1000);
  }

  return games;
}

// Lấy chi tiết từng game
async function getGameDetails(game) {
  try {
    const res = await fetch(game.url);
    if (!res.ok) {
      log(`⚠️  Skip ${game.title} (status ${res.status})`);
      return null;
    }

    const html = await res.text();
    const $ = cheerio.load(html);

    const info = {};

    // Thông tin cơ bản
    info.Title = $("h1").first().text().trim();
    info.Platform = $(".gameinfo_item:contains('Platform:') a").text().trim() || "Unknown";
    info.Players = $(".gameinfo_item:contains('Players:')").text().replace("Players:", "").trim() || "";
    info.Developer = $(".gameinfo_item:contains('Developer:') a").text().trim() || "";
    info.Publisher = $(".gameinfo_item:contains('Publisher:') a").text().trim() || "";
    info.Genre = $(".gameinfo_item:contains('Genre:') a").map((_, a) => $(a).text().trim()).get().join(", ");
    info.ReleaseDate = $(".gameinfo_item:contains('Release Date:')").text().replace("Release Date:", "").trim() || "";
    info.Overview = $(".gameinfo_item:contains('Overview:')").text().replace("Overview:", "").trim() || "";

    return info;
  } catch (e) {
    log(`❌ Error parsing ${game.title}: ${e.message}`);
    return null;
  }
}

// Ghi ra CSV an toàn
function toCSV(data) {
  if (!data.length) return "";
  const headers = Object.keys(data[0]);
  const lines = [headers.join(",")];

  for (const row of data) {
    const line = headers
      .map(h => `"${String(row[h] || "").replace(/"/g, '""').replace(/\r?\n|\r/g, " ")}"`)
      .join(",");
    lines.push(line);
  }

  return lines.join("\n");
}

async function main() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const games = await getGameList();
  log(`🔍 Tổng số game tìm thấy: ${games.length}`);
  if (!games.length) return;

  const allData = [];

  for (let i = 0; i < games.length; i++) {
    const g = games[i];
    log(`→ [${i + 1}/${games.length}] ${g.title}`);
    const info = await getGameDetails(g);
    if (info) allData.push(info);
    await delay(800); // tránh bị chặn IP
  }

  if (!allData.length) {
    log("❌ Không có dữ liệu hợp lệ để ghi CSV!");
    return;
  }

  const csv = toCSV(allData);
  fs.writeFileSync(OUTPUT_FILE, csv);
  log(`✅ Đã lưu ${allData.length} game vào ${OUTPUT_FILE}`);
}

main().catch(e => {
  console.error("Fatal error:", e);
  process.exit(1);
});
