import fs from "fs";
import path from "path";
import puppeteer from "puppeteer";
import * as cheerio from "cheerio";

const PLATFORM_ID = 7; // NES
const BASE_URL = `https://thegamesdb.net/list_games.php?platform_id=${PLATFORM_ID}`;
const OUTPUT_DIR = "data";
const OUTPUT_FILE = path.join(OUTPUT_DIR, `NES_games.csv`);

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}
function log(m) {
  console.log(`[${new Date().toISOString()}] ${m}`);
}

function toCSV(data) {
  if (!data.length) return "";
  const headers = Object.keys(data[0]);
  const rows = data.map(d =>
    headers.map(h => `"${String(d[h] || "").replace(/"/g, '""')}"`).join(",")
  );
  return [headers.join(","), ...rows].join("\n");
}

async function scrapeListPage(page, pageNum) {
  const url = `${BASE_URL}&page=${pageNum}`;
  await page.goto(url, { waitUntil: "networkidle2" });
  await delay(1000);

  const html = await page.content();
  const $ = cheerio.load(html);
  const cards = $(".card.border-primary");
  const games = [];

  cards.each((_, el) => {
    const title = $(el).find(".card-header a").text().trim();
    const href = $(el).find(".card-header a").attr("href");
    if (title && href) {
      games.push({
        title,
        url: new URL(href, "https://thegamesdb.net/").href,
      });
    }
  });

  const hasNext =
    $(".page-link").filter((_, el) => $(el).text().trim() === "Next").length > 0;

  return { games, hasNext };
}

async function scrapeGameDetails(page, game) {
  try {
    await page.goto(game.url, { waitUntil: "networkidle2" });
    await delay(500);
    const html = await page.content();
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

    return data;
  } catch (e) {
    log(`❌ ${game.title} error: ${e.message}`);
    return null;
  }
}

async function main() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  log("🔧 Bắt đầu quét danh sách game NES...");
  let allGames = [];
  let pageNum = 1;

  while (true) {
    const { games, hasNext } = await scrapeListPage(page, pageNum);
    allGames.push(...games);
    log(`Trang ${pageNum}: lấy được ${games.length} game`);
    if (!hasNext) break;
    pageNum++;
  }

  log(`📜 Tổng cộng ${allGames.length} game.`);

  const detailed = [];
  for (let i = 0; i < allGames.length; i++) {
    log(`→ [${i + 1}/${allGames.length}] ${allGames[i].title}`);
    const info = await scrapeGameDetails(page, allGames[i]);
    if (info) detailed.push(info);
    await delay(400);
  }

  const csv = toCSV(detailed);
  fs.writeFileSync(OUTPUT_FILE, csv);
  log(`✅ Đã lưu ${detailed.length} game vào ${OUTPUT_FILE}`);

  await browser.close();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
