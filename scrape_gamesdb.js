import fs from "fs";

const BASE_URL = "https://thegamesdb.net";

const PLATFORM_IDS = [
  23, 24, 4917, 4918, 4919,
  7, 6, 3, 2, 9, 4970, 4, 41, 5, 8, 4971, 4922,
  35, 18, 36, 20, 21, 33, 17, 16,
  10, 13,
  34, 4921,
  22, 27, 28, 4913, 4926,
  25, 4924, 4925
];

const OUTPUT_DIR = "data";
const CSV_HEADER = "title,alternate_titles,region,country,publisher,developer,release_date,players,coop,genre,esrb_rating,description";

function intEnv(name, fallback) {
  const v = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

const CONFIG = {
  maxRetries: intEnv("TGDB_MAX_RETRIES", 4),
  timeout: intEnv("TGDB_TIMEOUT_MS", 15000),
  concurrency: intEnv("TGDB_CONCURRENCY", 8),
  batchSize: intEnv("TGDB_BATCH_SIZE", 100),
  maxPages: intEnv("TGDB_MAX_PAGES", 1000),
  delayMs: intEnv("TGDB_DELAY_MS", 150),
  maxGamesPerPlatform: intEnv("TGDB_MAX_GAMES_PER_PLATFORM", 0),
};

if (process.env.TGDB_PLATFORM_IDS) {
  const ids = process.env.TGDB_PLATFORM_IDS.split(",").map((s) => Number.parseInt(s.trim(), 10)).filter(Number.isFinite);
  if (ids.length) PLATFORM_IDS.splice(0, PLATFORM_IDS.length, ...[...new Set(ids)]);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function decodeEntities(text) {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function cleanText(text) {
  if (!text) return "";
  return decodeEntities(text.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
}

function parseCsvLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"' && line[i + 1] === '"') { current += '"'; i++; }
    else if (char === '"') { inQuotes = !inQuotes; }
    else if (char === "," && !inQuotes) { result.push(current); current = ""; }
    else { current += char; }
  }
  result.push(current);
  return result;
}

function dedupKey(title, region, releaseDate) {
  return `${(title || "").trim().toLowerCase()}|${(region || "").trim().toLowerCase()}|${(releaseDate || "").trim().toLowerCase()}`;
}

function normalizeLabel(label) {
  return (label || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Nhãn thật trên trang có nhiều biến thể: Publisher(s) / Publishers(s),
// Release date(s) / ReleaseDate, Also Known As / Also know as.
// Đọc nhãn rồi chuẩn hoá thay vì khớp chuỗi cứng từng trường.
const FIELD_ALIASES = {
  alsoknownas: "alternate_titles",
  alsoknowas: "alternate_titles",
  region: "region",
  country: "country",
  publisher: "publisher",
  publishers: "publisher",
  publisherss: "publisher",
  developer: "developer",
  developers: "developer",
  releasedate: "release_date",
  releasedates: "release_date",
  players: "players",
  coop: "coop",
  genre: "genre",
  genres: "genre",
  esrbrating: "esrb_rating",
};

function extractFields(html) {
  const fields = {};
  for (const m of html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)) {
    const text = cleanText(m[1]);
    const colon = text.indexOf(":");
    if (colon <= 0) continue;
    const key = FIELD_ALIASES[normalizeLabel(text.slice(0, colon))];
    if (!key) continue;
    const value = text.slice(colon + 1).trim();
    if (value && !fields[key]) fields[key] = value;
  }
  // Tên khác nằm trong <h6>, không phải <p> (trang ghi đúng "Also know as").
  if (!fields.alternate_titles) {
    for (const m of html.matchAll(/<h6[^>]*>([\s\S]*?)<\/h6>/gi)) {
      const text = cleanText(m[1]);
      const colon = text.indexOf(":");
      if (colon > 0 && normalizeLabel(text.slice(0, colon)) === "alsoknowas") {
        fields.alternate_titles = text.slice(colon + 1).trim();
        break;
      }
    }
  }
  return fields;
}

function extractOverview(html) {
  const m = html.match(/class=["']game-overview["']/i);
  if (!m) return "";
  const open = html.indexOf(">", m.index);
  if (open < 0) return "";
  let depth = 1;
  let i = open + 1;
  const start = i;
  while (i < html.length && depth > 0) {
    const nextOpen = html.indexOf("<div", i);
    const nextClose = html.indexOf("</div>", i);
    if (nextClose < 0) break;
    if (nextOpen >= 0 && nextOpen < nextClose) { depth++; i = nextOpen + 4; }
    else { depth--; if (depth === 0) return stripOverviewFooter(cleanText(html.slice(start, nextClose))); i = nextClose + 6; }
  }
  return "";
}

function stripOverviewFooter(text) {
  return text.replace(/\s*Trailer:\s*YouTube\s*/i, " ").replace(/\s*ESRB Rating:.*$/s, "").replace(/\s*Genre\(s\):.*$/s, "").trim();
}

class NonRetryableError extends Error {}

class GameScraper {
  constructor() {
    this.stats = { total: 0, success: 0, errors: 0, skipped: 0 };
    this.shuttingDown = false;
  }

  async fetchWithRetry(url) {
    for (let attempt = 1; attempt <= CONFIG.maxRetries; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), CONFIG.timeout);
      try {
        const res = await fetch(url, {
          signal: controller.signal,
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
        });
        if (res.status === 404) throw new NonRetryableError(`HTTP 404: ${url}`);
        if (res.status === 429) {
          const retryAfter = Number.parseInt(res.headers.get("retry-after") || "0", 10);
          const wait = Math.min(Math.max(Number.isFinite(retryAfter) ? retryAfter * 1000 : 0, 1000 * attempt), 60000);
          console.error(`⏳ 429 rate limit, chờ ${Math.round(wait / 1000)}s rồi thử lại (${attempt}/${CONFIG.maxRetries})`);
          if (attempt === CONFIG.maxRetries) throw new Error(`HTTP 429: ${url}`);
          await sleep(wait);
          continue;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.text();
      } catch (error) {
        if (error instanceof NonRetryableError) throw error;
        if (attempt === CONFIG.maxRetries) throw error;
        const backoff = Math.min(1000 * 2 ** (attempt - 1), 30000) + Math.floor(Math.random() * 500);
        await sleep(backoff);
      } finally {
        clearTimeout(timeoutId);
      }
    }
  }

  readExistingGames(platformName) {
    const cleanName = platformName.replace(/[<>:"/\\|?*]/g, "").trim();
    const filePath = `${OUTPUT_DIR}/${cleanName}.csv`;
    if (!fs.existsSync(filePath)) return new Set();
    try {
      const content = fs.readFileSync(filePath, "utf8");
      const allLines = content.split(/\r?\n/).filter((l) => l.trim());
      if (!allLines.length) return new Set();
      let header = ["title", "alternate_titles", "region", "country", "publisher", "developer", "release_date"];
      let lines = allLines;
      if (allLines[0].toLowerCase().includes("title")) {
        header = parseCsvLine(allLines[0]).map((h) => h.trim().toLowerCase());
        lines = allLines.slice(1);
      }
      const idx = (name) => header.indexOf(name);
      const keys = new Set();
      for (const line of lines) {
        const c = parseCsvLine(line);
        const title = c[idx("title")]?.trim();
        if (!title) continue;
        keys.add(dedupKey(title, c[idx("region")] || "", c[idx("release_date")] || ""));
      }
      console.log(`📚 Tìm thấy ${keys.size} game đã tồn tại trong CSV`);
      return keys;
    } catch {
      return new Set();
    }
  }

  hasNextPage(html, page) {
    if (new RegExp(`href=["'][^"']*page=${page + 1}[^"']*["']`, "i").test(html)) return true;
    if (/> ?Next ?</i.test(html) || /aria-label=["']Next/i.test(html)) return true;
    return false;
  }

  async scrapeGameIds(platformId) {
    console.log(`📥 Đang quét danh sách ID cho Platform: ${platformId}...`);
    let page = 1;
    const gameIdsSet = new Set();
    let platformName = "";
    while (page <= CONFIG.maxPages) {
      const url = `${BASE_URL}/list_games.php?platform_id=${platformId}&page=${page}`;
      let html;
      try {
        html = await this.fetchWithRetry(url);
      } catch (error) {
        console.error(`❌ Lỗi trang ${page}:`, error.message);
        break;
      }
      if (page === 1 && !platformName) {
        const match = html.match(/<legend[^>]*>(.*?)<\/legend>/i);
        platformName = match ? cleanText(match[1]) : `Platform_${platformId}`;
        console.log(`🎮 Platform: "${platformName}"`);
      }
      const matches = [...html.matchAll(/href=["'][^"']*game\.php\?id=(\d+)/gi)];
      if (matches.length === 0) break;
      const before = gameIdsSet.size;
      matches.forEach((m) => gameIdsSet.add(m[1]));
      if (gameIdsSet.size === before) {
        console.log(`🛑 Trang ${page} không thêm ID mới, dừng để tránh lặp vô hạn`);
        break;
      }
      if (CONFIG.maxGamesPerPlatform > 0 && gameIdsSet.size >= CONFIG.maxGamesPerPlatform) break;
      if (!this.hasNextPage(html, page)) break;
      page++;
    }
    const gameIds = Array.from(gameIdsSet);
    if (CONFIG.maxGamesPerPlatform > 0) gameIds.splice(CONFIG.maxGamesPerPlatform);
    console.log(`📋 Lấy được tổng cộng ${gameIds.length} ID game duy nhất\n`);
    return { gameIds, platformName };
  }

  async scrapeGameDetailsHtml(gameId) {
    try {
      const html = await this.fetchWithRetry(`${BASE_URL}/game.php?id=${gameId}`);
      const titleMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
      let title = titleMatch ? cleanText(titleMatch[1]) : "";
      if (!title) {
        const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        title = t ? cleanText(t[1]).split(" - ")[0].split("|")[0] : "";
      }
      if (!title) throw new Error("Không tìm thấy tiêu đề");
      const f = extractFields(html);
      return {
        title,
        alternate_titles: f.alternate_titles || "",
        region: f.region || "",
        country: f.country || "",
        publisher: f.publisher || "",
        developer: f.developer || "",
        release_date: f.release_date || "",
        players: f.players || "",
        coop: f.coop || "",
        genre: f.genre || "",
        esrb_rating: f.esrb_rating || "",
        description: extractOverview(html),
      };
    } catch (error) {
      return { error: error.message };
    }
  }

  async runWorkerPool(items, workerFn, concurrencyLimit) {
    let index = 0;
    const worker = async (workerNo) => {
      let first = true;
      while (index < items.length) {
        if (this.shuttingDown) break;
        const currentIndex = index++;
        if (!first && CONFIG.delayMs > 0) await sleep(CONFIG.delayMs + Math.floor(Math.random() * 100));
        first = false;
        await workerFn(items[currentIndex], currentIndex);
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrencyLimit, items.length) }, (_, i) => worker(i)));
  }

  async scrapePlatform(platformId, usedNames) {
    const { gameIds, platformName: rawName } = await this.scrapeGameIds(platformId);
    if (gameIds.length === 0) return null;
    let platformName = rawName;
    const baseName = rawName.replace(/[<>:"/\\|?*]/g, "").trim();
    if (usedNames.has(baseName)) platformName = `${rawName}_${platformId}`;
    usedNames.add(platformName.replace(/[<>:"/\\|?*]/g, "").trim());

    const existingGames = this.readExistingGames(platformName);
    console.log(`⚡ Bắt đầu cào chi tiết cho ${gameIds.length} game (Song song: ${CONFIG.concurrency})...`);
    const buffer = [];
    let added = 0;
    let completed = 0;
    const flush = () => {
      if (!buffer.length) return;
      this.savePlatformData(platformName, buffer.splice(0));
    };

    await this.runWorkerPool(gameIds, async (gameId) => {
      const result = await this.scrapeGameDetailsHtml(gameId);
      completed++;
      if (completed % 100 === 0 || completed === gameIds.length) {
        console.log(`📊 Tiến độ: ${completed}/${gameIds.length} (${((completed / gameIds.length) * 100).toFixed(1)}%) | Đã thêm mới: ${added}`);
      }
      if (result.error) { this.stats.errors++; return; }
      const key = dedupKey(result.title, result.region, result.release_date);
      if (existingGames.has(key)) { this.stats.skipped++; return; }
      existingGames.add(key);
      this.stats.success++;
      added++;
      buffer.push(result);
      if (buffer.length >= CONFIG.batchSize) flush();
    }, CONFIG.concurrency);

    flush();
    this.stats.total += gameIds.length;
    return { platformName, added };
  }

  savePlatformData(platformName, newGames) {
    if (!newGames.length) return;
    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const cleanName = platformName.replace(/[<>:"/\\|?*]/g, "").trim() || "Platform";
    const outputFile = `${OUTPUT_DIR}/${cleanName}.csv`;
    const formatCsvRow = (g) => [
      g.title, g.alternate_titles, g.region, g.country, g.publisher,
      g.developer, g.release_date, g.players, g.coop, g.genre,
      g.esrb_rating, g.description,
    ].map((x) => `"${String(x || "").replace(/"/g, '""')}"`).join(",");
    const rows = newGames.map(formatCsvRow).join("\n");
    if (fs.existsSync(outputFile)) {
      const currentContent = fs.readFileSync(outputFile, "utf8");
      if (!currentContent.trim()) {
        fs.writeFileSync(outputFile, `${CSV_HEADER}\n${rows}\n`);
      } else if (!currentContent.split(/\r?\n/)[0].toLowerCase().includes("title")) {
        fs.writeFileSync(outputFile, `${CSV_HEADER}\n${currentContent.replace(/\n$/, "")}\n${rows}\n`);
      } else {
        const needsNewLine = !currentContent.endsWith("\n");
        fs.appendFileSync(outputFile, (needsNewLine ? "\n" : "") + rows + "\n");
      }
      console.log(`📝 Đã nối thêm ${newGames.length} game mới vào: ${outputFile}`);
    } else {
      fs.writeFileSync(outputFile, `${CSV_HEADER}\n${rows}\n`);
      console.log(`💾 Tạo mới tệp CSV thành công với ${newGames.length} game: ${outputFile}`);
    }
  }

  async scrapeGameIdsDirect(gameIds, platformName) {
    const existingGames = this.readExistingGames(platformName);
    const buffer = [];
    let added = 0;
    let completed = 0;
    const flush = () => { if (buffer.length) this.savePlatformData(platformName, buffer.splice(0)); };
    await this.runWorkerPool(gameIds, async (gameId) => {
      const result = await this.scrapeGameDetailsHtml(gameId);
      completed++;
      if (result.error) { this.stats.errors++; return; }
      const key = dedupKey(result.title, result.region, result.release_date);
      if (existingGames.has(key)) { this.stats.skipped++; return; }
      existingGames.add(key);
      this.stats.success++;
      added++;
      buffer.push(result);
      if (buffer.length >= CONFIG.batchSize) flush();
    }, CONFIG.concurrency);
    flush();
    this.stats.total += gameIds.length;
    return { platformName, added };
  }

  async run() {
    if (process.env.TGDB_GAME_IDS) {
      const ids = process.env.TGDB_GAME_IDS.split(",").map((s) => s.trim()).filter(Boolean);
      console.log(`🎮 Chế độ test: cào ${ids.length} game theo ID...\n`);
      const r = await this.scrapeGameIdsDirect(ids, "Test");
      console.log(`✅ Test: thêm mới ${r.added} game`);
      console.log(`\n📈 Thống kê: thêm mới ${this.stats.success}, bỏ qua ${this.stats.skipped}, lỗi ${this.stats.errors}`);
      return;
    }
    console.log(`🎮 Khởi chạy Scraper cho ${PLATFORM_IDS.length} hệ máy (song song ${CONFIG.concurrency}, đợt lưu ${CONFIG.batchSize}, tối đa ${CONFIG.maxPages} trang/hệ)...\n`);
    const usedNames = new Set();
    for (const platformId of PLATFORM_IDS) {
      if (this.shuttingDown) break;
      console.log(`\n🔸 Đang xử lý Platform ID: ${platformId}`);
      const platformData = await this.scrapePlatform(platformId, usedNames);
      if (platformData) console.log(`✅ ${platformData.platformName}: thêm mới ${platformData.added} game`);
      else console.log(`⚠️ Không lấy được game nào cho Platform ID ${platformId}`);
    }
    console.log(`\n📈 Thống kê kết quả:`);
    console.log(`✅ Thêm mới thành công: ${this.stats.success}`);
    console.log(`⏭️ Bỏ qua (Đã tồn tại): ${this.stats.skipped}`);
    console.log(`❌ Lỗi kết nối: ${this.stats.errors}`);
    if (this.shuttingDown) return;
    if (this.stats.total === 0) throw new Error("Không cào được game nào (total = 0), kiểm tra lại kết nối / cấu trúc trang");
    if (this.stats.success === 0 && this.stats.skipped === 0) throw new Error("Không lấy được chi tiết game nào, kiểm tra lại cấu trúc trang game.php");
  }
}

async function main() {
  const scraper = new GameScraper();
  const stop = () => {
    if (!scraper.shuttingDown) {
      console.log("\n🛑 Nhận tín hiệu dừng, sẽ lưu đợt đang có rồi thoát");
      scraper.shuttingDown = true;
    }
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  try {
    await scraper.run();
    if (scraper.shuttingDown) process.exitCode = 130;
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

main();
