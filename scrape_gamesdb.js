import fs from "fs";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const BASE_URL = "https://thegamesdb.net";
const PLATFORM_ID = 7; // NES
const PLATFORM_NAME = "NES";
const OUTPUT_DIR = "data";
const OUTPUT_FILE = `${OUTPUT_DIR}/${PLATFORM_NAME}_games.csv`;
const MAX_CONCURRENT = 10; // số request đồng thời

// 🧩 Hàm lấy danh sách ID game theo platform (duyệt qua tất cả trang)
async function collectAllGameList(platformId) {
  let page = 1;
  const ids = new Set();

  while (true) {
    const url = `${BASE_URL}/list_games.php?platform_id=${platformId}&page=${page}`;
    console.log(`📄 Fetch list page ${page}: ${url}`);

    const res = await fetch(url);
    if (!res.ok) break;
    const html = await res.text();
    const $ = cheerio.load(html);

    const newIds = $("a[href*='game.php?id=']")
      .map((_, el) => {
        const href = $(el).attr("href");
        const m = href.match(/id=(\\d+)/);
        return m ? m[1] : null;
      })
      .get()
      .filter(Boolean);

    if (newIds.length === 0) break;

    newIds.forEach(id => ids.add(id));

    const hasNext = $("a.page-link:contains('Next')").length > 0;
    if (!hasNext) break;
    page++;
  }

  console.log(`✅ Found ${ids.size} games total`);
  return Array.from(ids);
}

// 🎮 Lấy thông tin chi tiết của từng game
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

// 🧠 Hàng đợi song song có giới hạn
async function processWithLimit(items, limit, fn) {
  const results = [];
  const executing = [];

  for (const item of items) {
    const p = fn(item).then(res => results.push(res)).catch(err => {
      console.warn(`⚠️ Error fetching ${item}: ${err.message}`);
    });

    executing.push(p);

    if (executing.length >= limit) {
      await Promise.race(executing);
      // loại bỏ những promise đã xong
      for (let i = executing.length - 1; i >= 0; i--) {
        if (executing[i].status === "fulfilled" || executing[i].status === "rejected") {
          executing.splice(i, 1);
        }
      }
    }
  }

  await Promise.allSettled(executing);
  return results;
}

// 💾 Lưu dữ liệu ra CSV
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

// 🚀 Chạy toàn bộ
async function run() {
  const ids = await collectAllGameList(PLATFORM_ID);
  console.log(`🚀 Start fetching ${ids.length} games (max ${MAX_CONCURRENT} concurrent)`);

  const details = await processWithLimit(ids, MAX_CONCURRENT, getGameDetail);

  if (details.length > 0) {
    saveToCSV(details, OUTPUT_FILE);
  } else {
    console.log("⚠️ No data fetched.");
  }
}

run().catch(err => {
  console.error("❌ Fatal error:", err);
  process.exit(1);
});
