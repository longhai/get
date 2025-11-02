import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const PLATFORM_ID = 7; // NES
const OUTPUT_DIR = "./data";
const OUTPUT_FILE = path.join(OUTPUT_DIR, "NES_games.csv");

async function getHTML(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return await res.text();
}

async function scrapeList() {
  const games = [];
  let page = 1;

  while (true) {
    const url = `https://thegamesdb.net/list_games.php?platform_id=${PLATFORM_ID}&page=${page}`;
    console.log("📄 Fetch:", url);
    const html = await getHTML(url);
    const $ = cheerio.load(html);
    const links = $(".game_list_item a").toArray();

    if (links.length === 0) break;

    for (const a of links) {
      const title = $(a).text().trim();
      const href = $(a).attr("href");
      const idMatch = href?.match(/id=(\d+)/);
      if (idMatch) games.push({ id: idMatch[1], title });
    }

    const next = $(".pagination a:contains('Next')").length > 0;
    if (!next) break;
    page++;
  }

  console.log(`✅ Tìm thấy ${games.length} game`);
  return games;
}

async function scrapeGame(id) {
  const html = await getHTML(`https://thegamesdb.net/game.php?id=${id}`);
  const $ = cheerio.load(html);
  const info = (label) =>
    $(`b:contains("${label}")`).parent().text().replace(label, "").trim();

  return {
    Title: $("h1").first().text().trim(),
    Developer: info("Developer:"),
    Publisher: info("Publisher:"),
    Genre: info("Genres:"),
    Players: info("Players:"),
    ReleaseDate: info("Release Date:"),
    Overview: $(".game_overview").text().trim().replace(/\s+/g, " "),
  };
}

async function saveCSV(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(","),
    ...rows.map((r) =>
      headers
        .map((h) => `"${String(r[h] || "").replace(/"/g, '""')}"`)
        .join(",")
    ),
  ].join("\n");
  fs.writeFileSync(file, csv, "utf8");
  console.log(`💾 Lưu ${rows.length} game vào ${file}`);
}

async function main() {
  const list = await scrapeList();
  const results = [];

  const batchSize = 5;
  for (let i = 0; i < list.length; i += batchSize) {
    const batch = list.slice(i, i + batchSize);
    const games = await Promise.all(
      batch.map(async (g) => {
        try {
          const d = await scrapeGame(g.id);
          console.log(`✔️ ${d.Title}`);
          return d;
        } catch {
          console.warn(`⚠️ Bỏ qua ${g.title}`);
          return null;
        }
      })
    );
    results.push(...games.filter(Boolean));
  }

  if (results.length > 0) {
    await saveCSV(OUTPUT_FILE, results);
  } else {
    console.warn("⚠️ Không lấy được dữ liệu nào!");
  }
}

main().catch((e) => {
  console.error("🔥 Lỗi:", e);
  process.exit(1);
});
