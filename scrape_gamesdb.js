import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const PLATFORM_ID = 7; // NES
const BASE_URL = `https://thegamesdb.net/list_games.php?platform_id=${PLATFORM_ID}`;
const OUTPUT_DIR = "data";
const OUTPUT_FILE = path.join(OUTPUT_DIR, `NES_games.csv`);
const CONCURRENCY = 10;

async function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// 🔹 Lấy danh sách game theo từng trang
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

    const cards = $("div.card.border-primary.mb-3");
    if (!cards.length) break;

    cards.each((_, el) => {
      const title = $(el).find(".card-footer p:first-child").text().trim();
      const href = $(el).find(".card-footer p:first-child a").attr("href");
      if (href && title) {
        games.push({
          title,
          url: new URL(href, "https://thegamesdb.net/").href,
        });
      }
    });

    const hasNext = $("a.page-link:contains('Next')").length > 0;
    if (!hasNext) break;

    page++;
    await delay(1000);
  }

  log(`✅ Tổng số game lấy được: ${games.length}`);
  return games;
}

// 🔹 Lấy chi tiết từng game
async function getGameDetails(game) {
  try {
    const res = await fetch(game.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const $ = cheerio.load(html);

    const findText = (label) => {
      const el = $(`p:contains('${label}')`).first();
      if (!el.length) return "";
      return el.text().replace(label, "").trim();
    };

    const data = {
      Title: $("h1").first().text().trim() || game.title,
      Platform: findText("Platform:"),
      Region: findText("Region:"),
      Country: findText("Country:"),
      Developer: findText("Developer:"),
      Publisher: findText("Publisher:"),
      Players: findText("Players:"),
      Coop: findText("Co-op:"),
      Genre: findText("Genre(s):"),
      ReleaseDate: findText("Release Date:"),
      Overview: $(".game-overview").text().trim(),
      URL: game.url,
    };

    return data;
  } catch (err) {
    log(`❌ Error on ${game.title}: ${err.message}`);
    return null;
  }
}

// 🔹 Chuyển sang CSV
function toCSV(data) {
  if (!data.length) return "";
  const headers = Object.keys(data[0]);
  const lines = [headers.join(",")];
  for (const row of data) {
    const values = headers.map((h) =>
      `"${String(row[h] || "").replace(/"/g, '""').replace(/\r?\n|\r/g, " ")}"`
    );
    lines.push(values.join(","));
  }
  return lines.join("\n");
}

// 🔹 Chạy song song
async function processQueue(items, limit, fn) {
  const results = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      const r = await fn(items[i], i);
      results[i] = r;
      await delay(200);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// 🔹 Main
async function main() {
  log("🔧 Bắt đầu scraper...");

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const games = await getGameList();
  if (!games.length) {
    log("⚠️ Không tìm thấy game nào (có thể HTML thay đổi).");
    fs.writeFileSync(OUTPUT_FILE, "No data\n");
    return;
  }

  const results = await processQueue(games, CONCURRENCY, async (g, i) => {
    log(`→ [${i + 1}/${games.length}] ${g.title}`);
    return await getGameDetails(g);
  });

  const valid = results.filter(Boolean);
  if (!valid.length) {
    log("⚠️ Không có dữ liệu hợp lệ nào để ghi CSV.");
    fs.writeFileSync(OUTPUT_FILE, "No valid data\n");
    return;
  }

  const csv = toCSV(valid);
  fs.writeFileSync(OUTPUT_FILE, csv);
  log(`✅ Đã lưu ${valid.length} game vào ${OUTPUT_FILE}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
