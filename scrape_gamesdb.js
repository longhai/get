import fs from "fs";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const PLATFORMS = [7, 6]; // NES, SNES
const OUTPUT_DIR = "data";
const CONCURRENCY = 10; // số game song song mỗi batch
const FETCH_TIMEOUT = 15000; // timeout 15s
const RETRY_LIMIT = 3; // số lần thử lại khi lỗi

// Helper fetch có timeout & retry
async function safeFetch(url, retry = 0) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (err) {
    clearTimeout(timeout);
    if (retry < RETRY_LIMIT) {
      console.warn(`⚠️ Fetch lỗi, thử lại (${retry + 1}/${RETRY_LIMIT}) → ${url}`);
      return await safeFetch(url, retry + 1);
    } else {
      console.error(`❌ Bỏ qua: ${url}`);
      return "";
    }
  }
}

// Lấy tên platform
async function getPlatformName(platformId) {
  const html = await safeFetch(`https://thegamesdb.net/list_games.php?platform_id=${platformId}`);
  const $ = cheerio.load(html);
  const name = $("h1").first().text().trim();
  return name || `platform_${platformId}`;
}

// Lấy tất cả ID game (pagination)
async function getAllGameIds(platformId) {
  const ids = new Set();
  let page = 1;
  let hasNext = true;

  while (hasNext) {
    const url = `https://thegamesdb.net/list_games.php?platform_id=${platformId}&page=${page}`;
    console.log(`📥 Lấy game từ platform ${platformId}, trang ${page}...`);
    const html = await safeFetch(url);
    if (!html) break;

    const $ = cheerio.load(html);
    $("a[href*='game.php?id=']").each((_, el) => {
      const href = $(el).attr("href");
      const match = href.match(/game\.php\?id=(\d+)/);
      if (match) ids.add(match[1]);
    });

    hasNext = $("a:contains('Next')").length > 0;
    page++;
  }

  console.log(`✅ Platform ${platformId}: ${ids.size} game tìm thấy`);
  return [...ids];
}

// Scrape chi tiết game
async function scrapeGame(id) {
  const html = await safeFetch(`https://thegamesdb.net/game.php?id=${id}`);
  if (!html) return null;

  const $ = cheerio.load(html);
  const header = $("div.card-header").first();

  const title = header.find("h1").text().trim();
  if (!title) return null;

  let alsoKnownAs = header.find("h6.text-muted").text().replace("Also know as:", "").trim();
  if (alsoKnownAs.includes("|")) alsoKnownAs = alsoKnownAs.split("|")[0].trim();

  const overview = $("p.game-overview").text().replace(/\s+/g, " ").trim();
  const esrb = $("div.card-body p:contains('ESRB Rating:')").text().replace("ESRB Rating:", "").trim();
  const genres = $("div.card-body p:contains('Genre(s):')").text().replace("Genre(s):", "").trim();
  const region = $("div.card-body p:contains('Region:')").text().replace("Region:", "").trim();
  const country = $("div.card-body p:contains('Country:')").text().replace("Country:", "").trim();
  const developers = $("div.card-body p:contains('Developer') a").map((_, el) => $(el).text().trim()).get().join("; ");
  const publishers = $("div.card-body p:contains('Publisher') a").map((_, el) => $(el).text().trim()).get().join("; ");
  const releaseDate = $("div.card-body p:contains('ReleaseDate:')").text().replace("ReleaseDate:", "").trim();
  const players = $("div.card-body p:contains('Players:')").text().replace("Players:", "").trim();
  const coop = $("div.card-body p:contains('Co-op:')").text().replace("Co-op:", "").trim();

  return { title, alsoKnownAs, releaseDate, region, country, developers, publishers, players, coop, esrb, genres, overview };
}

// Main
async function main() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

  for (const PLATFORM_ID of PLATFORMS) {
    console.log(`\n=== 🔍 Bắt đầu scrape platform ${PLATFORM_ID} ===`);

    const PLATFORM_NAME = await getPlatformName(PLATFORM_ID);
    const safeName = PLATFORM_NAME.replace(/[/\\?%*:|"<>]/g, "_");
    const OUTPUT_FILE = `${OUTPUT_DIR}/${safeName}.csv`;

    const header = "title,also_known_as,release_date,region,country,developers,publishers,players,co_op,esrb,genres,overview\n";
    fs.writeFileSync(OUTPUT_FILE, header);

    const ids = await getAllGameIds(PLATFORM_ID);
    let done = 0;

    for (let i = 0; i < ids.length; i += CONCURRENCY) {
      const batch = ids.slice(i, i + CONCURRENCY);
      const results = await Promise.all(batch.map(scrapeGame));

      for (const g of results) {
        if (!g) continue;
        const row = [
          g.title,
          g.alsoKnownAs,
          g.releaseDate,
          g.region,
          g.country,
          g.developers,
          g.publishers,
          g.players,
          g.coop,
          g.esrb,
          g.genres,
          g.overview
        ].map(v => `"${(v || "").replace(/"/g, '""')}"`).join(",");
        fs.appendFileSync(OUTPUT_FILE, row + "\n");
        done++;
      }

      console.log(`✅ [${PLATFORM_NAME}] Đã scrape ${done}/${ids.length}`);
    }

    console.log(`🎯 Xong platform ${PLATFORM_NAME} → ${OUTPUT_FILE}`);
  }
}

main().catch(err => console.error("❌ Lỗi tổng:", err));
