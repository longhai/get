import fs from "fs";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const BASE_LIST_URL = "https://thegamesdb.net/list_games.php";
const BASE_GAME_URL = "https://thegamesdb.net/game.php?id=";
const PLATFORM_ID = 7; // NES
const OUTPUT_DIR = "data";
const OUTPUT_FILE = `${OUTPUT_DIR}/NES.csv`;

async function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// 🧠 Lấy danh sách game cơ bản (id + tên + ảnh + ngày phát hành)
async function scrapeList(platformId) {
  let page = 1;
  let results = [];

  while (true) {
    const url = `${BASE_LIST_URL}?platform_id=${platformId}&page=${page}`;
    console.log(`🔹 Fetching list page ${page}`);
    const res = await fetch(url);
    const html = await res.text();
    const $ = cheerio.load(html);

    const cards = $("div.card.border-primary");
    if (cards.length === 0) break;

    cards.each((_, el) => {
      const idMatch = $(el).find("a").attr("href")?.match(/id=(\d+)/);
      const id = idMatch ? idMatch[1] : "";
      const title = $(el).find(".card-footer p").first().text().trim();
      const img = $(el).find("img").attr("src")?.trim() || "";
      const info = $(el).find(".card-footer p");
      const region = $(info[1]).text().replace("Region:", "").trim();
      const date = $(info[2]).text().replace("Release Date:", "").trim();
      const platform = $(el).find(".text-muted").text().replace("Platform:", "").trim();

      if (id) results.push({ id, title, img, region, date, platform });
    });

    const hasNext = $("a.page-link:contains('Next')").length > 0;
    if (!hasNext) break;
    page++;
    await delay(1000); // tránh bị chặn
  }

  console.log(`📃 Found ${results.length} games`);
  return results;
}

// 🧩 Lấy chi tiết từng game (overview, dev, pub, genre, ...)
async function scrapeDetails(gameId) {
  const url = `${BASE_GAME_URL}${gameId}`;
  const res = await fetch(url);
  const html = await res.text();
  const $ = cheerio.load(html);

  const overview = $("h4:contains('Overview')").next("p").text().trim();
  const developers = $("strong:contains('Developers:')").parent().text().replace("Developers:", "").trim();
  const publishers = $("strong:contains('Publishers:')").parent().text().replace("Publishers:", "").trim();
  const genres = $("strong:contains('Genres:')").parent().text().replace("Genres:", "").trim();
  const players = $("strong:contains('Players:')").parent().text().replace("Players:", "").trim();
  const coop = $("strong:contains('Co-op:')").parent().text().replace("Co-op:", "").trim();
  const esrb = $("strong:contains('ESRB:')").parent().text().replace("ESRB:", "").trim();

  return { overview, developers, publishers, genres, players, coop, esrb };
}

async function main() {
  console.log("📥 Scraping NES game list...");
  const games = await scrapeList(PLATFORM_ID);

  console.log("🔍 Fetching details for each game...");
  for (let i = 0; i < games.length; i++) {
    const g = games[i];
    console.log(`   [${i + 1}/${games.length}] ${g.title}`);
    const details = await scrapeDetails(g.id);
    Object.assign(g, details);
    await delay(800); // tránh bị rate-limit
  }

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

  const header = [
    "id", "title", "region", "release_date", "platform", "image_url",
    "developers", "publishers", "genres", "players", "coop", "esrb", "overview"
  ].join(",");

  const csv = [header, ...games.map(g =>
    [
      g.id, g.title, g.region, g.date, g.platform, g.img,
      g.developers, g.publishers, g.genres, g.players, g.coop, g.esrb, g.overview
    ]
      .map(v => `"${(v || "").replace(/"/g, '""')}"`)
      .join(",")
  )].join("\n");

  fs.writeFileSync(OUTPUT_FILE, csv);
  console.log(`✅ Saved ${games.length} games → ${OUTPUT_FILE}`);
}

main().catch(err => {
  console.error("❌ Error:", err);
  process.exit(1);
});
