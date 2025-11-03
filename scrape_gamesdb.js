import fs from "fs";
import fetch from "node-fetch";
import * as cheerio from "cheerio";
import path from "path";

const BASE_URL = "https://thegamesdb.net";
const PLATFORM_ID = process.argv[2] || 7; // mặc định NES (7)
const OUTPUT_DIR = "./data";
const CONCURRENCY = 8;

function safeFileName(name) {
  return name.replace(/[<>:"/\\|?*]+/g, "_");
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ======= Lấy danh sách ID game theo platform =======
async function getAllGameIds(platformId) {
  let nextUrl = `${BASE_URL}/list_games.php?platform_id=${platformId}`;
  const ids = new Set();
  let platformName = "Unknown Platform";
  let page = 1;

  console.log(`📥 Lấy danh sách game platform_id=${platformId}...`);

  while (nextUrl) {
    console.log(`🔎 Trang ${page}: ${nextUrl}`);
    const res = await fetch(nextUrl);
    const html = await res.text();
    const $ = cheerio.load(html);

    const header = $("h1").first().text().trim();
    if (header) platformName = header;

    $("a[href*='game.php?id=']").each((_, el) => {
      const href = $(el).attr("href");
      const match = href.match(/game\.php\?id=(\d+)/);
      if (match) ids.add(match[1]);
    });

    const nextLink = $("a.page-link:contains('Next')");
    const href = nextLink.attr("href");
    if (href && href !== "#") {
      nextUrl = href.startsWith("http")
        ? href
        : `${BASE_URL}/${href.replace(/^\/+/, "")}`;
      page++;
    } else {
      nextUrl = null;
    }

    await sleep(300);
  }

  console.log(`✅ ${ids.size} game (${page} trang) — ${platformName}`);
  return { platformName, ids: Array.from(ids) };
}

// ======= Lấy thông tin từng game =======
async function scrapeGame(id) {
  const url = `${BASE_URL}/game.php?id=${id}`;
  try {
    const res = await fetch(url);
    const html = await res.text();
    const $ = cheerio.load(html);

    const header = $("div.card-header").first();
    const title = header.find("h1").text().trim();
    if (!title) throw new Error("Không tìm thấy tiêu đề!");

    let alsoKnownAs = header.find("h6.text-muted").text().replace("Also know as:", "").trim();
    if (alsoKnownAs.includes("|")) alsoKnownAs = alsoKnownAs.split("|")[0].trim();

    const overview = $("p.game-overview").text().replace(/\s+/g, " ").trim();
    const esrb = $("div.card-body p:contains('ESRB Rating:')")
      .text().replace("ESRB Rating:", "").trim();
    const genres = $("div.card-body p:contains('Genre(s):')")
      .text().replace("Genre(s):", "").trim();
    const region = $("div.card-body p:contains('Region:')")
      .text().replace("Region:", "").trim();
    const country = $("div.card-body p:contains('Country:')")
      .text().replace("Country:", "").trim();
    const developers = $("div.card-body p:contains('Developer') a")
      .map((_, el) => $(el).text().trim()).get().join("; ");
    const publishers = $("div.card-body p:contains('Publisher') a")
      .map((_, el) => $(el).text().trim()).get().join("; ");
    const releaseDate = $("div.card-body p:contains('ReleaseDate:')")
      .text().replace("ReleaseDate:", "").trim();
    const players = $("div.card-body p:contains('Players:')")
      .text().replace("Players:", "").trim();
    const coop = $("div.card-body p:contains('Co-op:')")
      .text().replace("Co-op:", "").trim();

    return {
      id, title, alsoKnownAs, releaseDate, region, country,
      developers, publishers, players, coop, esrb, genres, overview
    };
  } catch (err) {
    console.error(`⚠️ Lỗi ${id}: ${err.message}`);
    return null;
  }
}

// ======= CSV =======
function writeCsvHeader(file) {
  const header = "title,also_known_as,release_date,region,country,developers,publishers,players,co_op,esrb,genres,overview\n";
  fs.writeFileSync(file, header);
}
function writeCsvLine(file, game) {
  const line = [
    game.title, game.alsoKnownAs, game.releaseDate, game.region, game.country,
    game.developers, game.publishers, game.players, game.coop, game.esrb, game.genres, game.overview
  ].map(x => `"${(x || "").replace(/"/g, '""')}"`).join(",");
  fs.appendFileSync(file, line + "\n");
}

// ======= MAIN =======
async function main() {
  ensureDir(OUTPUT_DIR);

  const { platformName, ids } = await getAllGameIds(PLATFORM_ID);
  const safeName = safeFileName(platformName);
  const csvPath = path.join(OUTPUT_DIR, `${safeName}.csv`);
  const cachePath = path.join(OUTPUT_DIR, `${safeName}.cache.json`);

  if (!fs.existsSync(csvPath)) writeCsvHeader(csvPath);
  if (!fs.existsSync(cachePath)) fs.writeFileSync(cachePath, JSON.stringify([]));

  let done = JSON.parse(fs.readFileSync(cachePath, "utf8"));
  const remain = ids.filter(id => !done.includes(id));

  console.log(`🔁 Resume ${done.length}/${ids.length}`);

  for (let i = 0; i < remain.length; i += CONCURRENCY) {
    const batch = remain.slice(i, i + CONCURRENCY);
    console.log(`⚙️ Batch ${i + 1}/${remain.length}`);
    const results = await Promise.all(batch.map(scrapeGame));

    for (const g of results.filter(Boolean)) {
      writeCsvLine(csvPath, g);
      done.push(g.id);
      console.log(`💾 ${g.title}`);
    }

    fs.writeFileSync(cachePath, JSON.stringify(done));
    console.log(`📦 Cache: ${done.length}/${ids.length}`);
    await sleep(300);
  }

  console.log(`✅ Hoàn tất. File: ${csvPath}`);
}

main().catch(e => console.error("❌ Lỗi chính:", e));
