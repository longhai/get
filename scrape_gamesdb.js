import fs from "fs";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const PLATFORMS = [7, 6]; // NES, SNES
const OUTPUT_DIR = "data";
const CACHE_DIR = `${OUTPUT_DIR}/cache`;
const CONCURRENCY = process.env.GITHUB_ACTIONS ? 4 : 10;
const FETCH_TIMEOUT = 15000;
const RETRY_LIMIT = 3;

// Tạo thư mục cần thiết
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR);

// Delay ngẫu nhiên
function randomDelay() {
  return new Promise(r => setTimeout(r, 500 + Math.random() * 1000));
}

// Fetch có cache + retry + timeout
async function cachedFetch(url, cacheFile, retry = 0) {
  if (fs.existsSync(cacheFile)) {
    const cached = fs.readFileSync(cacheFile, "utf8");
    if (cached.trim()) return cached;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    fs.writeFileSync(cacheFile, html);
    return html;
  } catch (err) {
    clearTimeout(timeout);
    if (retry < RETRY_LIMIT) {
      console.warn(`⚠️ Fetch lỗi (${retry + 1}/${RETRY_LIMIT}) → ${url}`);
      await randomDelay();
      return await cachedFetch(url, cacheFile, retry + 1);
    } else {
      console.error(`❌ Bỏ qua: ${url}`);
      return "";
    }
  }
}

// Lấy tên platform
async function getPlatformName(platformId) {
  const cacheFile = `${CACHE_DIR}/platform_${platformId}.html`;
  const html = await cachedFetch(`https://thegamesdb.net/list_games.php?platform_id=${platformId}`, cacheFile);
  const $ = cheerio.load(html);
  const name = $("h1").first().text().trim();
  return name || `platform_${platformId}`;
}

// Lấy danh sách ID game (cache theo platform)
async function getAllGameIds(platformId) {
  const cacheListFile = `${CACHE_DIR}/list_${platformId}.json`;
  if (fs.existsSync(cacheListFile)) {
    console.log(`📦 Dùng cache danh sách game platform ${platformId}`);
    return JSON.parse(fs.readFileSync(cacheListFile, "utf8"));
  }

  const ids = new Set();
  let page = 1;
  let hasNext = true;

  while (hasNext) {
    const url = `https://thegamesdb.net/list_games.php?platform_id=${platformId}&page=${page}`;
    console.log(`📥 Lấy danh sách game ${platformId}, trang ${page}...`);
    const cacheFile = `${CACHE_DIR}/list_${platformId}_page${page}.html`;
    const html = await cachedFetch(url, cacheFile);
    if (!html) break;

    const $ = cheerio.load(html);
    $("a[href*='game.php?id=']").each((_, el) => {
      const match = $(el).attr("href")?.match(/game\.php\?id=(\d+)/);
      if (match) ids.add(match[1]);
    });

    hasNext = $("a:contains('Next')").length > 0;
    page++;
    await randomDelay();
  }

  const allIds = [...ids];
  fs.writeFileSync(cacheListFile, JSON.stringify(allIds, null, 2));
  console.log(`✅ Platform ${platformId}: ${allIds.length} game tìm thấy`);
  return allIds;
}

// Scrape chi tiết game (dùng cache HTML)
async function scrapeGame(id) {
  const cacheFile = `${CACHE_DIR}/game_${id}.html`;
  const html = await cachedFetch(`https://thegamesdb.net/game.php?id=${id}`, cacheFile);
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

async function main() {
  for (const PLATFORM_ID of PLATFORMS) {
    console.log(`\n=== 🔍 Scrape platform ${PLATFORM_ID} ===`);
    const PLATFORM_NAME = await getPlatformName(PLATFORM_ID);
    const safeName = PLATFORM_NAME.replace(/[/\\?%*:|"<>]/g, "_");
    const OUTPUT_FILE = `${OUTPUT_DIR}/${safeName}.csv`;
    const DONE_FILE = `${OUTPUT_DIR}/${safeName}.done.json`;

    const csvHeader = "title,also_known_as,release_date,region,country,developers,publishers,players,co_op,esrb,genres,overview\n";
    if (!fs.existsSync(OUTPUT_FILE)) fs.writeFileSync(OUTPUT_FILE, csvHeader);

    const doneIds = fs.existsSync(DONE_FILE) ? new Set(JSON.parse(fs.readFileSync(DONE_FILE, "utf8"))) : new Set();
    const allIds = await getAllGameIds(PLATFORM_ID);
    const todo = allIds.filter(id => !doneIds.has(id));

    console.log(`🧩 Tổng ${allIds.length} game (${doneIds.size} đã có, ${todo.length} còn lại)`);

    let done = doneIds.size;
    for (let i = 0; i < todo.length; i += CONCURRENCY) {
      const batch = todo.slice(i, i + CONCURRENCY);
      const results = await Promise.all(batch.map(scrapeGame));

      for (let j = 0; j < batch.length; j++) {
        const id = batch[j];
        const g = results[j];
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
        doneIds.add(id);
        done++;
      }

      fs.writeFileSync(DONE_FILE, JSON.stringify([...doneIds]));
      console.log(`✅ [${PLATFORM_NAME}] ${done}/${allIds.length} game`);
      await randomDelay();
    }

    console.log(`🎯 Hoàn tất platform ${PLATFORM_NAME} → ${OUTPUT_FILE}`);
  }
}

main().catch(err => console.error("❌ Lỗi tổng:", err));
