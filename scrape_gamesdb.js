import fs from "fs";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const URL = "https://thegamesdb.net/game.php?id=29289"; // ví dụ game NES

async function scrapeGame(url) {
  const res = await fetch(url);
  const html = await res.text();
  const $ = cheerio.load(html);

  const header = $("div.card-header").first();

  // Title
  const title = header.find("h1").text().trim();

  // Also Known As - chỉ lấy phần trước dấu |
  let alsoKnownAs = header.find("h6.text-muted").text().replace("Also know as:", "").trim();
  if (alsoKnownAs.includes("|")) alsoKnownAs = alsoKnownAs.split("|")[0].trim();

  // Overview
  const overview = $("p.game-overview").text().replace(/\s+/g, " ").trim();

  // ESRB
  const esrb = $("div.card-body p")
                .filter((_, el) => $(el).text().trim().startsWith("ESRB Rating:"))
                .text().replace("ESRB Rating:", "").trim();

  // Genres
  const genres = $("div.card-body p")
                   .filter((_, el) => $(el).text().trim().startsWith("Genre(s):"))
                   .text().replace("Genre(s):", "").trim();

  // Thông tin khác
  const region = $("div.card-body p:contains('Region:')").text().replace("Region:", "").trim();
  const country = $("div.card-body p:contains('Country:')").text().replace("Country:", "").trim();
  const developers = $("div.card-body p:contains('Developer') a").map((_, el) => $(el).text().trim()).get().join("; ");
  const publishers = $("div.card-body p:contains('Publisher') a").map((_, el) => $(el).text().trim()).get().join("; ");
  const releaseDate = $("div.card-body p:contains('ReleaseDate:')").text().replace("ReleaseDate:", "").trim();
  const players = $("div.card-body p:contains('Players:')").text().replace("Players:", "").trim();
  const coop = $("div.card-body p:contains('Co-op:')").text().replace("Co-op:", "").trim();

  return { title, alsoKnownAs, releaseDate, region, country, developers, publishers, players, coop, esrb, genres, overview };
}

async function main() {
  try {
    console.log("📥 Scraping game detail...");
    const game = await scrapeGame(URL);

    const platformName = "Nintendo Entertainment System (NES)";
    const OUTPUT_DIR = "data";
    const OUTPUT_FILE = `${OUTPUT_DIR}/${platformName}.csv`;

    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

    const csvHeader = "title,also_known_as,release_date,region,country,developers,publishers,players,co_op,esrb,genres,overview\n";
    const csvData = [
      game.title,
      game.alsoKnownAs,
      game.releaseDate,
      game.region,
      game.country,
      game.developers,
      game.publishers,
      game.players,
      game.coop,
      game.esrb,
      game.genres,
      game.overview
    ].map(x => `"${x.replace(/"/g, '""')}"`).join(",");

    fs.writeFileSync(OUTPUT_FILE, csvHeader + csvData);
    console.log(`✅ Saved game detail to ${OUTPUT_FILE}`);
  } catch (err) {
    console.error("❌ Error:", err);
  }
}

main();
