import fs from "fs";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const BASE_LIST_URL = "https://thegamesdb.net/list_games.php";
const BASE_GAME_URL = "https://thegamesdb.net/game.php";
const PLATFORM_ID = 7; // NES
const OUTPUT_DIR = "data";
const OUTPUT_FILE = `${OUTPUT_DIR}/nes_games.csv`;
const CONCURRENCY = 5;

async function getGameIds(platformId) {
  let page = 1;
  const ids = [];
  while (true) {
    const url = `${BASE_LIST_URL}?platform_id=${platformId}&page=${page}`;
    const res = await fetch(url);
    const html = await res.text();
    const $ = cheerio.load(html);

    const cards = $("div.card.border-primary");
    if (!cards.length) break;

    cards.each((_, el) => {
      const href = $(el).find("a").attr("href") || "";
      const match = href.match(/id=(\d+)/);
      if (match) ids.push(match[1]);
    });

    const hasNext = $("a.page-link:contains('Next')").length > 0;
    if (!hasNext) break;
    page++;
  }
  return ids;
}

async function scrapeGame(id) {
  const url = `${BASE_GAME_URL}?id=${id}`;
  try {
    const res = await fetch(url);
    const html = await res.text();
    const $ = cheerio.load(html);

    const getText = (label) => {
      const el = $(`p:contains('${label}')`).first();
      if (!el.length) return "";
      return el.text().replace(`${label}:`, "").trim();
    };

    const title = $("div.card-header h1").text().trim() || "";
    const alias = $("div.card-header h6").text().replace("Also know as:", "").trim() || "";
    const platform = getText("Platform") || "";
    const region = getText("Region") || "";
    const country = getText("Country") || "";
    const developers = $("p:contains('Developer') a").map((i, el) => $(el).text().trim()).get().join("|");
    const publishers = $("p:contains('Publisher') a").map((i, el) => $(el).text().trim()).get().join("|");
    const releaseDate = getText("ReleaseDate") || "";
    const players = getText("Players") || "";
    const coOp = getText("Co-op") || "";
    const overview = $("p.game-overview").text().trim() || "";
    const esrb = getText("ESRB Rating") || "";
    const genres = getText("Genre(s)") || "";

    if (!title) {
      console.log(`⚠️ Game ${id} empty title, skipping.`);
      return null;
    }

    return { title, alias, platform, region, country, developers, publishers, releaseDate, players, coOp, overview, esrb, genres };
  } catch (err) {
    console.error(`❌ Error fetching game ${id}:`, err.message);
    return null;
  }
}

async function scrapeAll(ids) {
  const results = [];
  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    const batch = ids.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(batch.map(scrapeGame));
    results.push(...batchResults.filter(r => r));
    console.log(`✅ Processed batch ${i} - ${i + batch.length}`);
  }
  return results;
}

async function main() {
  console.log("📥 Scraping started...");
  const ids = await getGameIds(PLATFORM_ID);
  console.log(`📌 Found ${ids.length} game IDs.`);

  const games = await scrapeAll(ids);
  console.log(`📌 Collected ${games.length} games with data.`);

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

  const csvHeader = "title,alias,platform,region,country,developers,publishers,releaseDate,players,coOp,overview,esrb,genres\n";
  const csvData = games
    .map(g => Object.values(g)
      .map(x => `"${(x || "").replace(/"/g, '""')}"`)
      .join(","))
    .join("\n");

  fs.writeFileSync(OUTPUT_FILE, csvHeader + csvData);
  console.log(`✅ Saved ${games.length} games to ${OUTPUT_FILE}`);
}

main().catch(err => {
  console.error("❌ Error:", err);
  process.exit(1);
});
