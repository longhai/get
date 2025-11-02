import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const PLATFORM_ID = 7; // NES
const OUTPUT_DIR = "./data";
const OUTPUT_FILE = path.join(OUTPUT_DIR, "NES_games.csv");

async function getHTML(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} at ${url}`);
  return await res.text();
}

async function scrapeList(platformId) {
  const games = [];
  let pageNum = 1;

  while (true) {
    const url = `https://thegamesdb.net/list_games.php?platform_id=${platformId}&page=${pageNum}`;
    console.log(`📄 Trang ${pageNum}...`);
    const html = await getHTML(url);
    const $ = cheerio.load(html);

    const rows = $(".game_list_item a").toArray();
    if (rows.length === 0) break;

    for (const a of rows) {
      const title = $(a).text().trim();
      const href = $(a).attr("href");
      const match = href?.match(/id=(\d+)/);
      if (match) games.push({ id: match[1], title });
    }

    const hasNext = $(".pagination a:contains('Next')").length > 0;
    if (!hasNext) break;
    pageNum++;
  }

  console.log(`✅ Tìm thấy ${games.length} game.`);
  return games;
}

async function scrapeGame(id) {
  const url = `https://thegamesdb.net/game.php?id=${id}`;
  const html = await getHTML(url);
  const $ = cheerio.load(html);

  const getText = (label) =>
    $(`b:contains("${label}")`).parent().text().replace(label, "").trim();

  return {
    Title: $("h1").first().text().trim(),
    Developer: getText("Developer:"),
    Publisher: getText("Publisher:"),
    Genre: getText("Genres:"),
    Players: getText("Players:"),
    ReleaseDate: getText("Release Date:"),
    Overview: $(".game_overview").text().trim().replace(/\s+/g, " "),
  };
}

async function saveCSV(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const headers = Object.keys(data[0]);
  const lines = [headers.join(",")];
  for (const row of data) {
    lines.push(
      headers.map((h) => `"${String(row[h] || "").replace(/"/g, '""')}"`).join(",")
    );
  }
  fs.writeFileSync(file, lines.join("\n"), "utf8");
  console.log(`💾 Lưu ${data.length} game vào ${file}`);
}

async function main() {
  console.log("🚀 Bắt đầu lấy dữ liệu NES...");
  const list = await scrapeList(PLATFORM_ID);
  const result = [];

  // chạy song song 5 game/lượt cho nhanh
  const chunkSize = 5;
  for (let i = 0; i < list.length; i += chunkSize) {
    const slice = list.slice(i, i + chunkSize);
    const details = await Promise.allSettled(
      slice.map((g) =>
        scrapeGame(g.id)
          .then((d) => ({ ...d }))
          .catch(() => null)
      )
    );
    result.push(...details.filter((r) => r.value).map((r) => r.value));
    console.log(`📦 ${result.length}/${list.length} game...`);
  }

  if (result.length > 0) await saveCSV(OUTPUT_FILE, result);
  else console.warn("⚠️ Không lấy được game nào!");
}

main().catch((err) => {
  console.error("🔥 Lỗi nghiêm trọng:", err);
  process.exit(1);
});
