import fs from "fs";
import fetch from "node-fetch";
import { load } from "cheerio";

const BASE_URL = "https://thegamesdb.net";
const PLATFORM_ID = 7; // NES
const PLATFORM_NAME = "NES";
const OUTPUT_DIR = "data";
const OUTPUT_FILE = `${OUTPUT_DIR}/${PLATFORM_NAME}_games.csv`;

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchPage(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (GitHub Scraper)" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return await res.text();
}

// Lấy danh sách tất cả game (tên + link id)
async function getGameList() {
  let games = [];
  let page = 1;

  while (true) {
    const url = `${BASE_URL}/list_games.php?platform_id=${PLATFORM_ID}&page=${page}`;
    console.log(`→ Fetching list page ${page}: ${url}`);
    const html = await fetchPage(url);
    const $ = load(html);

    const items = $(".card a[href*='game.php?id=']");
    if (!items.length) break;

    items.each((_, el) => {
      const href = $(el).attr("href");
      const idMatch = href.match(/id=(\d+)/);
      if (idMatch) {
        games.push({
          id: idMatch[1],
          title: $(el).text().trim(),
          url: BASE_URL + href,
        });
      }
    });

    // kiểm tra nút next
    const next = $(".pagination a.page-link").filter((_, el) =>
      $(el).text().includes("Next")
    );
    if (!next.length) break;
    page++;
    await delay(500);
  }
  console.log(`✅ Found ${games.length} games.`);
  return games;
}

// Lấy thông tin chi tiết từng game
async function getGameDetails(game) {
  try {
    const html = await fetchPage(game.url);
    const $ = load(html);

    const body = $(".card-body").first();
    const data = {
      Title: $("h1").first().text().trim(),
      AKA: $("h6.text-muted").text().replace("Also know as:", "").trim(),
      Platform: body.find("p:contains('Platform') a").text().trim(),
      Region: body.find("p:contains('Region')").text().replace("Region:", "").trim(),
      Country: body.find("p:contains('Country')").text().replace("Country:", "").trim(),
      Developer: body.find("p:contains('Developer') a").text().trim(),
      Publisher: body.find("p:contains('Publisher') a").text().trim(),
      ReleaseDate: body.find("p:contains('ReleaseDate')").text().replace("ReleaseDate:", "").trim(),
      Players: body.find("p:contains('Players')").text().replace("Players:", "").trim(),
      Coop: body.find("p:contains('Co-op')").text().replace("Co-op:", "").trim(),
      ESRB: $(".card-body p:contains('ESRB Rating')").text().replace("ESRB Rating:", "").trim(),
      Genre: $(".card-body p:contains('Genre')").text().replace("Genre(s):", "").trim(),
      Overview: $(".game-overview").text().trim(),
    };

    return data;
  } catch (e) {
    console.log(`⚠️ Failed ${game.id}: ${e.message}`);
    return null;
  }
}

// Xuất CSV
function toCSV(rows) {
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(headers.map((h) => `"${(r[h] || "").replace(/"/g, '""')}"`).join(","));
  }
  return lines.join("\n");
}

async function main() {
  const games = await getGameList();
  const allData = [];

  for (let i = 0; i < games.length; i++) {
    console.log(`→ [${i + 1}/${games.length}] ${games[i].title}`);
    const data = await getGameDetails(games[i]);
    if (data) allData.push(data);
    await delay(500); // tránh bị chặn
  }

  if (allData.length) {
    fs.writeFileSync(OUTPUT_FILE, toCSV(allData));
    console.log(`✅ Saved ${allData.length} games to ${OUTPUT_FILE}`);
  } else {
    console.log("❌ No data collected");
  }
}

main().catch((err) => console.error("Fatal error:", err));
