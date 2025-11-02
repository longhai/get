// ======== scrape_gamesdb.js (song song giới hạn) ========
import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const PLATFORM_ID = 7; // NES
const BASE_URL = `https://thegamesdb.net/list_games.php?platform_id=${PLATFORM_ID}`;
const OUTPUT_DIR = "data";
const OUTPUT_FILE = path.join(OUTPUT_DIR, `NES_games.csv`);
const CONCURRENCY = 10; // số request đồng thời

async function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}
function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// Lấy danh sách game
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
    if (!rows.length) break;

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

    return {
      Title: $("h1").first().text().trim(),
      Platform: $(".gameinfo_item:contains('Platform:') a").text().trim() || "Unknown",
      Players: $(".gameinfo_item:contains('Players:')").text().replace("Players:", "").trim() || "",
      Developer: $(".gameinfo_item:contains('Developer:') a").text().trim() || "",
      Publisher: $(".gameinfo_item:contains('Publisher:') a").text().trim() || "",
      Genre: $(".gameinfo_item:contains('Genre:') a").map((_, a) => $(a).text().trim()).get().join(", "),
      ReleaseDate: $(".gameinfo_item:contains('Release Date:')").text().replace("Release Date:", "").trim() || "",
      Overview: $(".gameinfo_item:contains('Overview:')").text().replace("Overview:", "").trim() || ""
    };
  } catch (e) {
    log(`❌ Error parsing ${game.title}: ${e.message}`);
    return null;
  }
}

// Xuất ra CSV
function toCSV(data) {
  if (!data.length) return "";
  const headers = Object.keys(data[0]);
  const lines = [headers.join(",")];
  for (const row of data) {
    lines.push(
      headers.map(h => `"${String(row[h] || "").replace(/"/g, '""').replace(/\r?\n|\r/g, " ")}"`).join(",")
    );
  }
  return lines.join("\n");
}

// Hàng đợi song song giới hạn
async function processQueue(items, limit, fn) {
  const results = [];
  let index = 0;
  async function next() {
    if (index >= items.length) return;
    const i = index++;
    const item = items[i];
    const result = await fn(item, i);
    results[i] = result;
    await next();
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => next());
  await Promise.all(workers);
  return results;
}

// Chạy chính
async function main() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const games = await getGameList();
  log(`🔍 Tổng số game: ${games.length}`);
  if (!games.length) return;

  const results = await processQueue(games, CONCURRENCY, async (g, i) => {
    log(`→ [${i + 1}/${games.length}] ${g.title}`);
    const info = await getGameDetails(g);
    await delay(300); // nhỏ để tránh spam
    return info;
  });

  const valid = results.filter(Boolean);
  const csv = toCSV(valid);
  fs.writeFileSync(OUTPUT_FILE, csv);
  log(`✅ Đã lưu ${valid.length} game vào ${OUTPUT_FILE}`);
}

main().catch(e => {
  console.error("Fatal error:", e);
  process.exit(1);
});
