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

// 🔹 Lấy danh sách game từ các trang list
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

// 🔹 Lấy chi tiết từng game
async function getGameDetails(game) {
  try {
    const res = await fetch(game.url);
    if (!res.ok) {
      log(`⚠️  Skip ${game.title} (status ${res.status})`);
      return null;
    }

    const html = await res.text();
    const $ = cheerio.load(html);

    const cardBody = $(".card-body");
    if (!cardBody.length) return null;

    const info = {
      Title: $("h1").first().text().trim(),
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

    return info;
  } catch (e) {
    log(`❌ Error parsing ${game.title}: ${e.message}`);
    return null;
  }
}

// 🔹 Chuyển dữ liệu thành CSV
function toCSV(data) {
  if (!data.length) return "";
  const headers = Object.keys(data[0]);
  const lines = [headers.join(",")];
  for (const row of data) {
    lines.push(
      headers
        .map((h) =>
          `"${String(row[h] || "")
            .replace(/"/g, '""')
            .replace(/\r?\n|\r/g, " ")}"`
        )
        .join(",")
    );
  }
  return lines.join("\n");
}

// 🔹 Chạy song song có giới hạn
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
  const workers = Array.from({ length: Math.min(limit, items.length) }, () =>
    next()
  );
  await Promise.all(workers);
  return results;
}

// 🔹 Hàm chính
async function main() {
  if (!fs.existsSync(OUTPUT_DIR))
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const games = await getGameList();
  log(`🔍 Tổng số game: ${games.length}`);
  if (!games.length) return;

  const results = await processQueue(games, CONCURRENCY, async (g, i) => {
    log(`→ [${i + 1}/${games.length}] ${g.title}`);
    const info = await getGameDetails(g);
    await delay(300);
    return info;
  });

  const valid = results.filter(Boolean);
  console.log("Ví dụ dữ liệu:", valid.slice(0, 2));

  if (valid.length) {
    const csv = toCSV(valid);
    fs.writeFileSync(OUTPUT_FILE, csv);
    log(`✅ Đã lưu ${valid.length} game vào ${OUTPUT_FILE}`);
  } else {
    log("⚠️ Không có dữ liệu nào được lưu, có thể lỗi selector.");
  }
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
