import fs from "fs";
import path from "path";
import puppeteer from "puppeteer";
import * as cheerio from "cheerio";

const PLATFORM_ID = 7; // NES
const OUTPUT_DIR = "./data";
const OUTPUT_FILE = path.join(OUTPUT_DIR, "NES_games.csv");

async function launchBrowser() {
  return await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-software-rasterizer",
    ],
  });
}

async function fetchHTML(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  return await page.content();
}

async function scrapeList(page, platformId) {
  const games = [];
  let pageNum = 1;

  while (true) {
    const url = `https://thegamesdb.net/list_games.php?platform_id=${platformId}&page=${pageNum}`;
    console.log(`📄 Đang lấy danh sách trang ${pageNum}...`);
    const html = await fetchHTML(page, url);
    const $ = cheerio.load(html);

    const rows = $(".game_list_item a").toArray();
    if (rows.length === 0) {
      console.log("⚠️ Hết trang hoặc không có dữ liệu.");
      break;
    }

    for (const a of rows) {
      const title = $(a).text().trim();
      const href = $(a).attr("href");
      if (href && title) {
        const idMatch = href.match(/id=(\d+)/);
        if (idMatch) games.push({ id: idMatch[1], title });
      }
    }

    const next = $(".pagination a:contains('Next')").length > 0;
    console.log(`✅ Trang ${pageNum}: ${rows.length} game`);
    if (!next) break;
    pageNum++;
  }

  return games;
}

async function scrapeGameDetail(page, id) {
  const url = `https://thegamesdb.net/game.php?id=${id}`;
  const html = await fetchHTML(page, url);
  const $ = cheerio.load(html);

  const getText = (label) =>
    $(`b:contains("${label}")`)
      .parent()
      .text()
      .replace(label, "")
      .trim();

  return {
    Title: $("h1").first().text().trim(),
    Developer: getText("Developer:"),
    Publisher: getText("Publisher:"),
    Genre: getText("Genres:"),
    Players: getText("Players:"),
    ReleaseDate: getText("Release Date:"),
    Overview: $(".game_overview").text().trim().replace(/\s+/g, " "),
  };
}

async function saveCSV(file, data) {
  if (!data.length) {
    console.warn("⚠️ Không có dữ liệu để lưu!");
    return;
  }

  fs.mkdirSync(path.dirname(file), { recursive: true });

  const headers = Object.keys(data[0]);
  const csvLines = [headers.join(",")];

  for (const row of data) {
    csvLines.push(
      headers
        .map((h) => `"${String(row[h] || "").replace(/"/g, '""')}"`)
        .join(",")
    );
  }

  fs.writeFileSync(file, csvLines.join("\n"), "utf8");
  console.log(`💾 Đã lưu ${data.length} dòng vào ${file}`);
}

async function main() {
  console.log("🚀 Bắt đầu quét TheGamesDB (NES)");
  const browser = await launchBrowser();
  const page = await browser.newPage();

  const gameList = await scrapeList(page, PLATFORM_ID);
  console.log(`🔢 Tổng cộng: ${gameList.length} game.`);

  const results = [];

  for (let i = 0; i < gameList.length; i++) {
    const g = gameList[i];
    console.log(`🎮 [${i + 1}/${gameList.length}] ${g.title}`);
    try {
      const detail = await scrapeGameDetail(page, g.id);
      results.push(detail);
    } catch (e) {
      console.error(`❌ Lỗi khi lấy ${g.title}:`, e.message);
    }
  }

  await saveCSV(OUTPUT_FILE, results);
  await browser.close();
  console.log("✅ Hoàn tất.");
}

main().catch((err) => {
  console.error("🔥 Fatal error:", err);
  process.exit(1);
});
