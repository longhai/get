import fs from "fs";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const BASE_URL = "https://thegamesdb.net";
const PLATFORM_ID = 7; // NES
const PLATFORM_NAME = "NES";
const OUTPUT_DIR = "data";
const OUTPUT_FILE = `${OUTPUT_DIR}/${PLATFORM_NAME}_games.csv`;

/** Lấy danh sách toàn bộ ID game trong 1 platform (có phân trang) */
async function collectAllGameList(platformId) {
  let page = 1;
  let allIds = new Set();

  while (true) {
    const url = `${BASE_URL}/list_games.php?platform_id=${platformId}&page=${page}`;
    console.log(`📄 Fetch list page ${page}: ${url}`);

    const res = await fetch(url);
    if (!res.ok) break;

    const html = await res.text();
    const $ = cheerio.load(html);

    const ids = $("a[href*='game.php?id=']")
      .map((_, el) => {
        const href = $(el).attr("href");
        const m = href.match(/id=(\d+)/);
        return m ? m[1] : null;
      })
      .get()
      .filter(Boolean);

    if (ids.length === 0) break;

    ids.forEach(id => allIds.add(id));

    const hasNext = $("a.page-link:contains('Next')").length > 0;
    if (!hasNext) break;
    page++;
  }

  console.log(`✅ Found ${allIds.size} games total`);
  return Array.from(allIds);
}

/** Lấy chi tiết từng game */
async function getGameDetail(id) {
  const url = `${BASE_URL}/game.php?id=${id}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const html = await res.text();
  const $ = cheerio.load(html);

  const title = $("h1").first().text().trim();
  const altName = $("h6.text-muted").first().text().replace("Also know as:", "").trim();
  const description = $(".game-overview").first().text().trim();
  const img = $(".card-img-top").attr("src") || "";
  const image = img.startsWith("http") ? img : `${BASE_URL}${img}`;

  const info = {};
  $("div.card-body p").each((_, el) => {
    const text = $(el).text().trim();
    if (text.includes(":")) {
      const [key, ...rest] = text.split(":");
      info[key.trim()] = rest.join(":").trim();
    }
  });

  return {
    id,
    title,
    altName,
    description,
    image,
    platform: info["Platform"] || "",
    region: info["Region"] || "",
    country: info["Country"] || "",
    developer: info["Developer(s)"] || "",
    publisher: info["Publishers(s)"] || "",
    releaseDate: info["ReleaseDate"] || "",
    players: info["Players"] || "",
    coop: info["Co-op"] || "",
    genre: info["Genre(s)"] || "",
    rating: info["ESRB Rating"] || "",
  };
}

/** Ghi dữ liệu ra CSV */
function saveToCSV(data, filePath) {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);
  const header = Object.keys(data[0]).join(",") + "\n";
  const rows = data
    .map(obj =>
      Object.values(obj)
        .map(v => `"${(v || "").replace(/"/g, '""')}"`)
        .join(",")
    )
    .join("\n");
  fs.writeFileSync(filePath, header + rows);
  console.log(`💾 Saved ${data.length} records → ${filePath}`);
}

/** Chạy toàn bộ quy trình */
async function run() {
  const ids = await collectAllGameList(PLATFORM_ID);
  const results = [];

  for (const [i, id] of ids.entries()) {
    try {
      console.log(`🎮 [${i + 1}/${ids.length}] Fetching game ID=${id}`);
      const detail = await getGameDetail(id);
      results.push(detail);
      // Giới hạn nhẹ để tránh bị chặn
      await new Promise(r => setTimeout(r, 1500));
    } catch (err) {
      console.warn(`⚠️ Skipped ${id}: ${err.message}`);
    }
  }

  if (results.length > 0) saveToCSV(results, OUTPUT_FILE);
}

run().catch(err => {
  console.error("❌ Fatal error:", err);
  process.exit(1);
});
