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
  await page.goto(url, { waitUntil: "domcontentloaded" });
  return await page.content();
}

async function scrapeList(page, platformId) {
  let games = [];
  let currentPage = 1;

  while (true) {
    const url = `https://thegamesdb.net/list_games.php?platform_id=${platformId}&page=${currentPage}`;
    console.log(`→ Fetch list page ${currentPage}: ${url}`);
    const html = await fetchHTML(page, url);
    const $ = cheerio.load(html);

    const rows = $(".game_list_item a").toArray();
    if (rows.length === 0) break;

    for (const a of rows) {
      const href = $(a).attr("href");
      const title = $(a).text().trim();
      if (href && title) {
        const match = href.match(/id=(\d+)/);
        if (match) games.push({ id: match[1], title });
      }
    }

    const next = $(".pagination a:contains('Next')").length > 0;
    if (!next) break;
    currentPage++;
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
      .trim() || "";

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

async function saveCSV(filename, data) {
  if (data.length === 0) return;
  const headers = Object.keys(data[0]);
  const rows = [headers.join(",")];

  for (const row of data) {
    const values = headers.map((h) =>
      `"${String(row[h] || "").replace(/"/g, '""')}"`
    );
    rows.push(values.join(","));
  }

  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, rows.join("\n"), "utf8");
}

async function main() {
  console.log("🚀 Bắt đầu scrape NES GamesDB...");
  const browser = await launchBrowser();
  const page = await browser.newPage();

  const gameList = await scrapeList(page, PLATFORM_ID);
  console.log(`📄 Tìm thấy ${gameList.length} game.`);

  let results = [];

  for (const [i, g] of gameList.entries()) {
    try {
      console.log(`🔍 [${i + 1}/${gameList.length}] ${g.title}`);
      const detail = await scrapeGameDetail(page, g.id);
      results.push(detail);
    } catch (err) {
      console.error(`❌ Lỗi lấy game ${g.title}:`, err.message);
    }
  }

  await saveCSV(OUTPUT_FILE, results);
  console.log(`✅ Đã lưu ${results.length} game vào ${OUTPUT_FILE}`);

  await browser.close();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
