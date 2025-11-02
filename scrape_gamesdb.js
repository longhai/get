import fs from "fs";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const BASE_URL = "https://thegamesdb.net/list_games.php";
const PLATFORM_ID = 7; // NES
const OUTPUT_DIR = "data";
const OUTPUT_FILE = `${OUTPUT_DIR}/nes_games.csv`;

async function scrapePlatform(platformId) {
  let page = 1;
  let results = [];

  while (true) {
    const url = `${BASE_URL}?platform_id=${platformId}&page=${page}`;
    console.log(`🔹 Fetching page ${page}: ${url}`);
    const res = await fetch(url);
    const html = await res.text();
    const $ = cheerio.load(html);

    const cards = $("div.card.border-primary");
    if (cards.length === 0) break;

    cards.each((_, el) => {
      const img = $(el).find("img").attr("src")?.trim() || "";
      const title = $(el).find(".card-footer p").first().text().trim();
      const info = $(el).find(".card-footer p");
      const region = $(info[1]).text().replace("Region:", "").trim();
      const date = $(info[2]).text().replace("Release Date:", "").trim();
      const platform = $(el).find(".text-muted").text().replace("Platform:", "").trim();
      const idMatch = $(el).find("a").attr("href")?.match(/id=(\d+)/);
      const id = idMatch ? idMatch[1] : "";

      results.push({ id, title, region, date, platform, img });
    });

    const hasNext = $("a.page-link:contains('Next')").length > 0;
    if (!hasNext) break;
    page++;
  }

  return results;
}

async function main() {
  console.log("📥 Scraping started...");
  const games = await scrapePlatform(PLATFORM_ID);
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);
  const csvHeader = "id,title,region,release_date,platform,image_url\n";
  const csvData = games
    .map(g => [g.id, g.title, g.region, g.date, g.platform, g.img]
      .map(x => `"${x.replace(/"/g, '""')}"`)
      .join(","))
    .join("\n");

  fs.writeFileSync(OUTPUT_FILE, csvHeader + csvData);
  console.log(`✅ Saved ${games.length} games to ${OUTPUT_FILE}`);
}

main().catch(err => {
  console.error("❌ Error:", err);
  process.exit(1);
});
