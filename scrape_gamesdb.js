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
  const header = $("div.card-header").first();

  const title = header.find("h1").text().trim();
  const alsoKnownAs = header.find("h6.text-muted").text().replace("Also know as:", "").trim();
  const overview = card.find("p.game-overview").text().trim();
  const esrb = card.find("p:contains('ESRB Rating:')").text().replace("ESRB Rating:", "").trim();
  const genres = card.find("p:contains('Genre')").text().replace("Genre(s):", "").trim();

  const platform = $("div.card-body p:contains('Platform:') a").text().trim();
  const region = $("div.card-body p:contains('Region:')").text().replace("Region:", "").trim();
  const country = $("div.card-body p:contains('Country:')").text().replace("Country:", "").trim();
  const developers = $("div.card-body p:contains('Developer') a").map((_, el) => $(el).text().trim()).get().join("; ");
  const publishers = $("div.card-body p:contains('Publisher') a").map((_, el) => $(el).text().trim()).get().join("; ");
  const releaseDate = $("div.card-body p:contains('ReleaseDate:')").text().replace("ReleaseDate:", "").trim();
  const players = $("div.card-body p:contains('Players:')").text().replace("Players:", "").trim();
  const coop = $("div.card-body p:contains('Co-op:')").text().replace("Co-op:", "").trim();

  return { title, alsoKnownAs, overview, esrb, genres, platform, region, country, developers, publishers, releaseDate, players, coop };
}

async function main() {
  try {
    console.log("📥 Scraping game detail...");
    const game = await scrapeGame(URL);

    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

    const csvHeader = "title,also_known_as,overview,esrb,genres,platform,region,country,developers,publishers,release_date,players,co_op\n";
    const csvData = [
      game.title,
      game.alsoKnownAs,
      game.overview,
      game.esrb,
      game.genres,
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
