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

  const card = $("div.card-body");
  
  const platform = card.find("p:contains('Platform:') a").text().trim();
  const region = card.find("p:contains('Region:')").text().replace("Region:", "").trim();
  const country = card.find("p:contains('Country:')").text().replace("Country:", "").trim();
  const developers = card.find("p:contains('Developer') a").map((_, el) => $(el).text().trim()).get().join("; ");
  const publishers = card.find("p:contains('Publisher') a").map((_, el) => $(el).text().trim()).get().join("; ");
  const releaseDate = card.find("p:contains('ReleaseDate:')").text().replace("ReleaseDate:", "").trim();
  const players = card.find("p:contains('Players:')").text().replace("Players:", "").trim();
  const coop = card.find("p:contains('Co-op:')").text().replace("Co-op:", "").trim();
  const title = $("h1").first().text().trim();

  return { title, platform, region, country, developers, publishers, releaseDate, players, coop };
}

async function main() {
  try {
    console.log("📥 Scraping game detail...");
    const game = await scrapeGame(URL);

    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

    const csvHeader = "title,platform,region,country,developers,publishers,release_date,players,co_op\n";
    const csvData = [
      game.title,
      game.platform,
      game.region,
      game.country,
      game.developers,
      game.publishers,
      game.releaseDate,
      game.players,
      game.coop
    ].map(x => `"${x.replace(/"/g, '""')}"`).join(",");

    fs.writeFileSync(OUTPUT_FILE, csvHeader + csvData);
    console.log(`✅ Saved game detail to ${OUTPUT_FILE}`);
  } catch (err) {
    console.error("❌ Error:", err);
  }
}

main();
