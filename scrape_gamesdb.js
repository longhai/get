import fs from "fs";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const PLATFORM_ID = 7; // NES
const BASE_LIST_URL = "https://thegamesdb.net/list_games.php";
const BASE_GAME_URL = "https://thegamesdb.net/game.php";
const OUTPUT_DIR = "data";

async function getGameIds(platformId) {
  let page = 1;
  const gameIds = [];

  while (true) {
    const url = `${BASE_LIST_URL}?platform_id=${platformId}&page=${page}`;
    console.log(`🔹 Fetching list page ${page}...`);
    const res = await fetch(url);
    const html = await res.text();
    const $ = cheerio.load(html);

    const cards = $("div.card.border-primary");
    if (cards.length === 0) break;

    cards.each((_, el) => {
      const href = $(el).find("a").attr("href") || "";
      const match = href.match(/id=(\d+)/);
      if (match) gameIds.push(match[1]);
    });

    const hasNext = $("a.page-link:contains('Next')").length > 0;
    if (!hasNext) break;
    page++;
  }

  console.log(`✅ Found ${gameIds.length} game IDs.`);
  return gameIds;
}

async function scrapeGame(id) {
  const url = `${BASE_GAME_URL}?id=${id}`;
  const res = await fetch(url);
  const html = await res.text();
  const $ = cheerio.load(html);

  const header = $("div.card-header").first();

  const title = header.find("h1").text().trim();

  let alsoKnownAs = header.find("h6.text-muted").text().replace("Also know as:", "").trim();
  if (alsoKnownAs.includes("|")) alsoKnownAs = alsoKnownAs.split("|")[0].trim();

  const overview = $("p.game-overview").text().replace(/\s+/g, " ").trim();

  const esrb = $("div.card-body p")
    .filter((_, el) => $(el).text().trim().startsWith("ESRB Rating:"))
    .text().replace("ESRB Rating:", "").trim();

  const genres = $("div.card-body p")
    .filter((_, el) => $(el).text().trim().startsWith("Genre(s):"))
    .text().replace("Genre(s):", "").trim();

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
    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

    const platformName = "Nintendo Entertainment System (NES)";
    const OUTPUT_FILE = `${OUTPUT_DIR}/${platformName}.csv`;

    const gameIds = await getGameIds(PLATFORM_ID);

    const allGames = [];
    for (let i = 0; i < gameIds.length; i++) {
      const id = gameIds[i];
      console.log(`📥 Scraping game ${i + 1}/${gameIds.length} (ID: ${id})`);
      const game = await scrapeGame(id);
      allGames.push(game);
    }

    const csvHeader = "title,also_known_as,release_date,region,country,developers,publishers,players,co_op,esrb,genres,overview\n";
    const csvData = allGames.map(game =>
      [
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
      ].map(x => `"${x.replace(/"/g, '""')}"`).join(",")
    ).join("\n");

    fs.writeFileSync(OUTPUT_FILE, csvHeader + csvData);
    console.log(`✅ Saved ${allGames.length} games to ${OUTPUT_FILE}`);
  } catch (err) {
    console.error("❌ Error:", err);
  }
}

main();
