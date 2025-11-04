import fs from "fs";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const BASE_URL = "https://thegamesdb.net";
const PLATFORM_ID = 7; // NES
const OUTPUT_DIR = "data";
const OUTPUT_FILE = `${OUTPUT_DIR}/NES.csv`;

// 📘 Lấy danh sách game theo platform
async function scrapeList(platformId) {
  let page = 1;
  const results = [];

  while (true) {
    const url = `${BASE_URL}/list_games.php?platform_id=${platformId}&page=${page}`;
    console.log(`🔹 Fetching list page ${page}: ${url}`);
    const res = await fetch(url);
    const html = await res.text();
    const $ = cheerio.load(html);

    const cards = $("div.card.border-primary");
    if (cards.length === 0) break;

    cards.each((_, el) => {
      const aTag = $(el).find("a").first();
      const href = aTag.attr("href");
      const idMatch = href?.match(/id=(\d+)/);
      const id = idMatch ? idMatch[1] : "";
      const title = $(el).find("h1").text().trim();
      const platform = $(el).find(".text-muted").text().replace("Platform:", "").trim();
      const img = $(el).find("img").attr("src")?.trim() || "";

      results.push({ id, title, platform, img });
    });

    const hasNext = $("a.page-link:contains('Next')").length > 0;
    if (!hasNext) break;
    page++;
  }

  return results;
}

// 📗 Lấy chi tiết từng game từ id
async function scrapeGameDetail(id) {
  const url = `${BASE_URL}/game.php?id=${id}`;
  console.log(`   ↳ Fetching details for game ${id}`);
  const res = await fetch(url);
  const html = await res.text();
  const $ = cheerio.load(html);

  const getText = (label) => {
    const el = $(`b:contains("${label}")`).parent();
    return el.text().replace(label, "").trim() || "";
  };

  const overview = $("div.card-body").find("p").first().text().trim();
  const genres = getText("Genres:");
  const developers = getText("Developers:");
  const publishers = getText("Publishers:");
  const releaseDate = getText("Release Date:");
  const players = getText("Players:");
  const coOp = getText("Co-op:");
  const esrb = getText("ESRB:");

  return { overview, genres, developers, publishers, releaseDate, players, coOp, esrb };
}

// 🧩 Gộp danh sách + chi tiết
async function main() {
  console.log("📥 Scraping started...");
  const list = await scrapeList(PLATFORM_ID);
  const detailed = [];

  for (const game of list) {
    try {
      const details = await scrapeGameDetail(game.id);
      detailed.push({ ...game, ...details });
    } catch (err) {
      console.warn(`⚠️ Failed to scrape game ${game.id}: ${err.message}`);
    }
  }

  // 📝 Xuất CSV
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);
  const csvHeader =
    "id,title,platform,image_url,genres,developers,publishers,releaseDate,players,coOp,esrb,overview\n";
  const csvData = detailed
    .map((g) =>
      [
        g.id,
        g.title,
        g.platform,
        g.img,
        g.genres,
        g.developers,
        g.publishers,
        g.releaseDate,
        g.players,
        g.coOp,
        g.esrb,
        g.overview,
      ]
        .map((x) => `"${(x || "").replace(/"/g, '""')}"`)
        .join(",")
    )
    .join("\n");

  fs.writeFileSync(OUTPUT_FILE, csvHeader + csvData);
  console.log(`✅ Saved ${detailed.length} games to ${OUTPUT_FILE}`);
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
