import fs from "fs";  
import http from "http";
import https from "https";
import fetch from "node-fetch";  

const BASE_URL = "https://thegamesdb.net";  

const PLATFORM_IDS = [  
  // --- 🕹️ ARCADE & MÁY THÙNG ---  
  23, 24, 4917, 4918, 4919,  
  // --- 🍄 NINTENDO ---  
  7, 6, 3, 2, 9, 4970, 4, 41, 5, 8, 4971, 4922,  
  // --- 🌀 SEGA ---  
  35, 18, 36, 20, 21, 33, 17, 16,  
  // --- 🎮 SONY ---  
  10, 13,  
  // --- 🔴 NEC ---  
  34, 4921,  
  // --- 🕹️ ATARI ---  
  22, 27, 28, 4913, 4926,  
  // --- 👾 RARE KHÁC ---  
  25, 4924, 4925  
];  

const OUTPUT_DIR = "data";  

const CONFIG = {  
  maxRetries: 3,  
  timeout: 12000,   // 12 giầy ngắt kết nối bị treo
  concurrency: 15   // 15 luồng song song - Tốc độ cao và an toàn với Server
};  

// Tái sử dụng HTTP/HTTPS Connection để tăng tốc truyền dữ liệu
const agentOptions = { keepAlive: true, maxSockets: 40 };
const httpAgent = new http.Agent(agentOptions);
const httpsAgent = new https.Agent(agentOptions);

function parseCsvLine(line) {  
  const result = [];  
  let current = '';  
  let inQuotes = false;  
    
  for (let i = 0; i < line.length; i++) {  
    const char = line[i];  
    if (char === '"' && line[i + 1] === '"') {  
      current += '"';  
      i++;  
    } else if (char === '"') {  
      inQuotes = !inQuotes;  
    } else if (char === ',' && !inQuotes) {  
      result.push(current);  
      current = '';  
    } else {  
      current += char;  
    }  
  }  
  result.push(current);  
  return result;  
}  

function cleanText(text) {
  if (!text) return '';
  return text.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

class GameScraper {  
  constructor() {  
    this.stats = { total: 0, success: 0, errors: 0, skipped: 0 };  
  }  

  async fetchWithRetry(url, retries = CONFIG.maxRetries) {  
    for (let attempt = 1; attempt <= retries; attempt++) {  
      try {  
        const controller = new AbortController();  
        const timeoutId = setTimeout(() => controller.abort(), CONFIG.timeout);  
        
        const res = await fetch(url, {   
          signal: controller.signal,  
          agent: (_parsedURL) => (_parsedURL.protocol === 'http:' ? httpAgent : httpsAgent),
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }  
        });  

        clearTimeout(timeoutId);  
        if (!res.ok) throw new Error(`HTTP ${res.status}`);  
        return await res.text();  
      } catch (error) {  
        if (attempt === retries) throw error;  
        await new Promise(resolve => setTimeout(resolve, 400 * attempt));  
      }  
    }  
  }  

  readExistingGames(platformName) {  
    const cleanName = platformName.replace(/[<>:"/\\|?*]/g, '').trim();  
    const filePath = `${OUTPUT_DIR}/${cleanName}.csv`;  
      
    if (!fs.existsSync(filePath)) return new Set();  

    try {  
      const content = fs.readFileSync(filePath, 'utf8');  
      const lines = content.split(/\r?\n/).slice(1);  
      const existingTitles = new Set();  
        
      lines.forEach(line => {  
        if (line.trim()) {  
          const columns = parseCsvLine(line);  
          const title = columns[0]?.trim();  
          if (title) existingTitles.add(title.toLowerCase());  
        }  
      });  
        
      console.log(`📚 Tìm thấy ${existingTitles.size} game đã tồn tại trong CSV`);  
      return existingTitles;  
    } catch (error) {  
      return new Set();  
    }  
  }  

  async scrapeGameIds(platformId) {  
    console.log(`📥 Đang quét danh sách ID cho Platform: ${platformId}...`);  
    let page = 1;  
    const gameIdsSet = new Set();  
    let platformName = "";  

    while (true) {  
      const url = `${BASE_URL}/list_games.php?platform_id=${platformId}&page=${page}`;  
        
      try {  
        const html = await this.fetchWithRetry(url);  
        
        if (page === 1 && !platformName) {  
          const match = html.match(/<legend[^>]*>(.*?)<\/legend>/i);
          platformName = match ? cleanText(match[1]) : `Platform_${platformId}`;
          console.log(`🎮 Platform: "${platformName}"`);  
        }  

        const matches = [...html.matchAll(/href=["'][^"']*game\.php\?id=(\d+)/gi)];
        if (matches.length === 0) break;  

        matches.forEach(m => gameIdsSet.add(m[1]));  

        if (!html.includes('Next')) break;  
        page++;  
      } catch (error) {  
        console.error(`❌ Lỗi trang ${page}:`, error.message);  
        break;  
      }  
    }  

    const gameIds = Array.from(gameIdsSet);  
    console.log(`📋 Lấy được tổng cộng ${gameIds.length} ID game duy nhất\n`);  
    return { gameIds, platformName };  
  }  

  async scrapeGameDetailsHtml(gameId) {  
    try {  
      const html = await this.fetchWithRetry(`${BASE_URL}/game.php?id=${gameId}`);  
      
      const getField = (label) => {
        const regex = new RegExp(`<p[^>]*>[\\s\\S]*?${label}[\\s\\S]*?:([\\s\\S]*?)<\\/p>`, 'i');
        const match = html.match(regex);
        return match ? cleanText(match[1]) : '';
      };

      const titleMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
      const title = titleMatch ? cleanText(titleMatch[1]) : '';

      if (!title) throw new Error('Không tìm thấy tiêu đề');

      const overviewMatch = html.match(/class=["']game-overview["'][^>]*>([\s\S]*?)<\/div>/i);

      return {  
        title,  
        alternate_titles: getField('Also know as'),  
        region: getField('Region'),  
        country: getField('Country'),  
        publisher: getField('Publishers\\(s\\)'),  
        developer: getField('Developer\\(s\\)'),  
        release_date: getField('ReleaseDate'),  
        players: getField('Players'),  
        coop: getField('Co-op'),  
        genre: getField('Genre\\(s\\)'),  
        esrb_rating: getField('ESRB Rating'),  
        description: overviewMatch ? cleanText(overviewMatch[1]) : ''  
      };  
    } catch (error) {  
      return { error: error.message };  
    }  
  }  

  async runWorkerPool(items, workerFn, concurrencyLimit) {
    const results = [];
    let index = 0;

    const worker = async () => {
      while (index < items.length) {
        const currentIndex = index++;
        results[currentIndex] = await workerFn(items[currentIndex], currentIndex);
      }
    };

    const workers = Array.from({ length: concurrencyLimit }, () => worker());
    await Promise.all(workers);
    return results;
  }

  async scrapePlatform(platformId) {  
    const { gameIds, platformName } = await this.scrapeGameIds(platformId);  
    if (gameIds.length === 0) return null;  

    const existingGames = this.readExistingGames(platformName);  
    console.log(`⚡ Bắt đầu cào chi tiết cho ${gameIds.length} game (Song song: ${CONFIG.concurrency})...`);  

    const newGames = [];
    let completed = 0;

    await this.runWorkerPool(gameIds, async (gameId) => {
      const result = await this.scrapeGameDetailsHtml(gameId);
      completed++;

      if (completed % 100 === 0 || completed === gameIds.length) {
        const percent = ((completed / gameIds.length) * 100).toFixed(1);
        console.log(`📊 Tiến độ: ${completed}/${gameIds.length} (${percent}%) | Đã thêm mới: ${newGames.length}`);
      }

      if (result.error) {  
        this.stats.errors++;  
        return;  
      }  

      if (existingGames.has(result.title.toLowerCase())) {  
        this.stats.skipped++;  
        return;  
      }  

      existingGames.add(result.title.toLowerCase());  
      this.stats.success++;  
      newGames.push(result);  
    }, CONFIG.concurrency);

    this.stats.total += gameIds.length;  
    return { platformName, games: newGames };  
  }  

  savePlatformData(platformName, newGames) {  
    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });  

    const cleanName = platformName.replace(/[<>:"/\\|?*]/g, '').trim();  
    const outputFile = `${OUTPUT_DIR}/${cleanName}.csv`;  
    const csvHeader = "title,alternate_titles,region,country,publisher,developer,release_date,players,coop,genre,esrb_rating,description";  
      
    const formatCsvRow = (g) => [  
      g.title, g.alternate_titles, g.region, g.country, g.publisher,   
      g.developer, g.release_date, g.players, g.coop, g.genre,   
      g.esrb_rating, g.description  
    ].map(x => `"${String(x || '').replace(/"/g, '""')}"`).join(",");  

    const rows = newGames.map(formatCsvRow).join("\n");  
      
    if (fs.existsSync(outputFile)) {  
      const currentContent = fs.readFileSync(outputFile, 'utf8');  
      const needsNewLine = currentContent.length > 0 && !currentContent.endsWith('\n');  
      fs.appendFileSync(outputFile, (needsNewLine ? '\n' : '') + rows + '\n');  
      console.log(`📝 Đã nối thêm ${newGames.length} game mới vào: ${outputFile}`);  
    } else {  
      fs.writeFileSync(outputFile, csvHeader + '\n' + rows + '\n');  
      console.log(`💾 Tạo mới tệp CSV thành công với ${newGames.length} game: ${outputFile}`);  
    }  
  }  

  async run() {  
    console.log(`🎮 Khởi chạy Scraper tối ưu cho ${PLATFORM_IDS.length} hệ máy...\n`);  

    for (const platformId of PLATFORM_IDS) {  
      console.log(`\n🔸 Dang xử lý Platform ID: ${platformId}`);  
      const platformData = await this.scrapePlatform(platformId);  
        
      if (platformData && platformData.games.length > 0) {  
        this.savePlatformData(platformData.platformName, platformData.games);  
      } else if (platformData) {  
        console.log(`✅ Tất cả dữ liệu game đã đầy đủ cho ${platformData.platformName}`);  
      }  
    }  

    console.log(`\n📈 Thống kê kết quả:`);  
    console.log(`✅ Thêm mới thành công: ${this.stats.success}`);  
    console.log(`⏭️ Bỏ qua (Đã tồn tại): ${this.stats.skipped}`);  
    console.log(`❌ Lỗi kết nối: ${this.stats.errors}`);  
  }  
}  

async function main() {  
  await new GameScraper().run();  
}  

process.on('SIGINT', () => {  
  console.log('\n🛑 Tiến trình bị ngắt bởi người dùng');  
  process.exit(0);  
});  

main().catch(console.error);
