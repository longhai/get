import fs from "fs";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const OUTPUT_DIR = "data";
const OUTPUT_FILE = `${OUTPUT_DIR}/nes_game_detail.csv`;
const URL = "https://thegamesdb.net/game.php?id=29289";

async function scrapeGame(url) {
  const res = await fetch(url);
  const html = await res.text();
  const $ = cheerio.load(html);

  const card = $("div.card-body").first();

  // Overview - lấy text của <p class="game-overview">, gộp thành 1 dòng
  const overview = card.find("p.game-overview").text().replace(/\s+/g, ' ').trim();

  // ESRB
  const esrb = card.find("p").filter((_, el) => $(el).text().startsWith("ESRB Rating:"))
                   .text().replace("ESRB Rating:", "").trim();

  // Genres
  const genres = card.find("p").filter((_, el) => $(el).text().startsWith("Genre(s):"))
                      .text().replace("Genre(s):", "").trim();

  return { overview, esrb, genres };
}

async function main() {
  try {
    console.log("📥 Scraping game detail...");
    const game = await scrapeGame(URL);
    
    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

    const csvHeader = "overview,esrb,genres\n";
    const csvData = [
      game.overview,
      game.esrb,
      game.genres
    ].map(x => `"${x.replace(/"/g, '""')}"`).join(",");

    fs.writeFileSync(OUTPUT_FILE, csvHeader + csvData);
    console.log(`✅ Saved game detail to ${OUTPUT_FILE}`);
  } catch (err) {
    console.error("❌ Error:", err);
  }
}

main();
