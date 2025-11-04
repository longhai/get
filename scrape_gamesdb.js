import fs from "fs";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const BASE_URL = "https://thegamesdb.net/list_games.php";
const PLATFORM_ID = 7; // NES
const OUTPUT_DIR = "data";
const BASIC_FILE = `${OUTPUT_DIR}/nes_games_basic.csv`;
const DETAILED_FILE = `${OUTPUT_DIR}/nes_games_detailed.csv`;

// Config
const CONFIG = {
  delayBetweenPages: 1000, // 1 giây giữa các trang
  delayBetweenDetails: 2000, // 2 giây giữa các game chi tiết
  maxRetries: 3,
  timeout: 30000 // 30 giây
};

class GameScraper {
  constructor() {
    this.stats = {
      basic: { total: 0, success: 0, errors: 0 },
      detailed: { total: 0, success: 0, errors: 0 }
    };
  }

  async fetchWithRetry(url, retries = CONFIG.maxRetries) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), CONFIG.timeout);
        
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.text();
        
      } catch (error) {
        console.warn(`⚠️ Attempt ${attempt}/${retries} failed for ${url}: ${error.message}`);
        if (attempt === retries) throw error;
        
        // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
  }

  async scrapeBasicList(platformId) {
    console.log("📥 Starting basic game list scraping...");
    let page = 1;
    let results = [];

    while (true) {
      const url = `${BASE_URL}?platform_id=${platformId}&page=${page}`;
      console.log(`🔹 Fetching page ${page}: ${url}`);
      
      try {
        const html = await this.fetchWithRetry(url);
        const $ = cheerio.load(html);

        const cards = $("div.card.border-primary");
        if (cards.length === 0) {
          console.log("📭 No more cards found, stopping.");
          break;
        }

        let pageCount = 0;
        cards.each((_, el) => {
          const img = $(el).find("img").attr("src")?.trim() || "";
          const title = $(el).find(".card-footer p").first().text().trim();
          const info = $(el).find(".card-footer p");
          const region = $(info[1]).text().replace("Region:", "").trim();
          const date = $(info[2]).text().replace("Release Date:", "").trim();
          const platform = $(el).find(".text-muted").text().replace("Platform:", "").trim();
          const idMatch = $(el).find("a").attr("href")?.match(/id=(\d+)/);
          const id = idMatch ? idMatch[1] : "";

          if (id) {
            results.push({ 
              id, 
              title, 
              region, 
              date, 
              platform, 
              img,
              detail_url: `https://thegamesdb.net/game.php?id=${id}`
            });
            pageCount++;
          }
        });

        this.stats.basic.success += pageCount;
        console.log(`✅ Page ${page}: Found ${pageCount} games`);

        const hasNext = $("a.page-link:contains('Next')").length > 0;
        if (!hasNext) {
          console.log("⏹️ No next page, stopping.");
          break;
        }
        
        page++;
        
        // Delay giữa các trang
        if (page > 1) {
          await new Promise(resolve => setTimeout(resolve, CONFIG.delayBetweenPages));
        }
        
      } catch (error) {
        console.error(`❌ Error on page ${page}:`, error.message);
        this.stats.basic.errors++;
        break;
      }
    }

    this.stats.basic.total = results.length;
    return results;
  }

  async scrapeGameDetails(gameId) {
    const url = `https://thegamesdb.net/game.php?id=${gameId}`;
    
    try {
      console.log(`🔍 Fetching details for game ${gameId}...`);
      const html = await this.fetchWithRetry(url);
      const $ = cheerio.load(html);

      // Lấy thông tin cơ bản
      const title = $("h1").first().text().trim();
      const alternateTitles = $("h2:contains('Alternate Titles') + p").text().trim();
      
      // Lấy thông tin từ bảng
      const gameInfo = {};
      $(".game-info table tr").each((_, row) => {
        const key = $(row).find("td").first().text().replace(':', '').trim();
        const value = $(row).find("td").last().text().trim();
        if (key && value) gameInfo[key] = value;
      });

      // Lấy mô tả
      const description = $("h2:contains('Description') + p").text().trim();

      // Lấy ảnh
      const images = [];
      $(".game-images img").each((_, img) => {
        const src = $(img).attr("src");
        if (src) images.push(src);
      });

      // Lấy rating (nếu có)
      const rating = $(".rating-value").text().trim();

      return {
        id: gameId,
        title,
        alternate_titles: alternateTitles,
        platform: gameInfo.Platform || "",
        publisher: gameInfo.Publisher || "",
        developer: gameInfo.Developer || "",
        genre: gameInfo.Genre || "",
        release_date: gameInfo["Release Date"] || "",
        region: gameInfo.Region || "",
        players: gameInfo.Players || "",
        rating: rating || "",
        description: description,
        images: images.join(" | "),
        scraped_at: new Date().toISOString()
      };
      
    } catch (error) {
      console.error(`❌ Error scraping game ${gameId}:`, error.message);
      return {
        id: gameId,
        error: error.message,
        scraped_at: new Date().toISOString()
      };
    }
  }

  async scrapeAllDetails(gameList) {
    console.log("📥 Starting detailed game scraping...");
    console.log(`📋 Total games to scrape: ${gameList.length}`);

    // Tạo CSV header cho file chi tiết
    const detailedHeader = "id,title,alternate_titles,platform,publisher,developer,genre,release_date,region,players,rating,description,images,scraped_at,error\n";
    
    if (!fs.existsSync(DETAILED_FILE)) {
      fs.writeFileSync(DETAILED_FILE, detailedHeader);
    }

    const validGames = gameList.filter(game => game.id);
    this.stats.detailed.total = validGames.length;

    // Scrape từng game với progress tracking
    for (let i = 0; i < validGames.length; i++) {
      const game = validGames[i];
      const details = await this.scrapeGameDetails(game.id);
      
      // Kết hợp thông tin cơ bản và chi tiết
      const combinedData = {
        ...game,
        ...details,
        basic_title: game.title, // Giữ lại title từ danh sách
        scraped_at: new Date().toISOString()
      };

      // Ghi vào CSV chi tiết
      const csvRow = [
        combinedData.id,
        combinedData.title || combinedData.basic_title,
        combinedData.alternate_titles || "",
        combinedData.platform || game.platform,
        combinedData.publisher || "",
        combinedData.developer || "",
        combinedData.genre || "",
        combinedData.release_date || game.date,
        combinedData.region || game.region,
        combinedData.players || "",
        combinedData.rating || "",
        combinedData.description || "",
        combinedData.images || game.img,
        combinedData.scraped_at,
        combinedData.error || ""
      ].map(x => `"${String(x).replace(/"/g, '""')}"`).join(",") + "\n";
      
      fs.appendFileSync(DETAILED_FILE, csvRow);
      
      if (combinedData.error) {
        this.stats.detailed.errors++;
      } else {
        this.stats.detailed.success++;
      }
      
      // Progress tracking
      const progress = ((i + 1) / validGames.length * 100).toFixed(1);
      console.log(`📊 Progress: ${i + 1}/${validGames.length} (${progress}%) | ✅ ${this.stats.detailed.success} | ❌ ${this.stats.detailed.errors}`);
      
      // Delay giữa các request chi tiết
      if (i < validGames.length - 1) {
        const delay = CONFIG.delayBetweenDetails + Math.random() * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  saveBasicData(games) {
    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);
    
    const csvHeader = "id,title,region,release_date,platform,image_url,detail_url\n";
    const csvData = games
      .map(g => [g.id, g.title, g.region, g.date, g.platform, g.img, g.detail_url]
        .map(x => `"${String(x).replace(/"/g, '""')}"`)
        .join(","))
      .join("\n");

    fs.writeFileSync(BASIC_FILE, csvHeader + csvData);
    console.log(`💾 Basic data saved to: ${BASIC_FILE}`);
  }

  printStats() {
    console.log("\n📈 ===== SCRAPING STATISTICS =====");
    console.log(`📋 Basic Scraping:`);
    console.log(`   Total: ${this.stats.basic.total}`);
    console.log(`   Success: ${this.stats.basic.success}`);
    console.log(`   Errors: ${this.stats.basic.errors}`);
    
    console.log(`\n🔍 Detailed Scraping:`);
    console.log(`   Total: ${this.stats.detailed.total}`);
    console.log(`   Success: ${this.stats.detailed.success}`);
    console.log(`   Errors: ${this.stats.detailed.errors}`);
    
    console.log(`\n💾 Output Files:`);
    console.log(`   Basic: ${BASIC_FILE}`);
    console.log(`   Detailed: ${DETAILED_FILE}`);
    console.log("====================================\n");
  }

  async run() {
    console.log("🎮 Starting NES GamesDB Scraper...\n");
    
    try {
      // Bước 1: Scrape danh sách cơ bản
      const basicGames = await this.scrapeBasicList(PLATFORM_ID);
      
      if (basicGames.length === 0) {
        console.log("❌ No games found. Exiting.");
        return;
      }
      
      this.saveBasicData(basicGames);
      
      // Bước 2: Scrape chi tiết từng game
      await this.scrapeAllDetails(basicGames);
      
      // Thống kê
      this.printStats();
      
      console.log("🎉 Scraping completed successfully!");
      
    } catch (error) {
      console.error("💥 Fatal error in scraper:", error);
      process.exit(1);
    }
  }
}

// Chạy scraper
async function main() {
  const scraper = new GameScraper();
  await scraper.run();
}

// Xử lý Ctrl+C
process.on('SIGINT', () => {
  console.log('\n🛑 Scraping interrupted by user');
  process.exit(0);
});

main().catch(err => {
  console.error("💥 Fatal error:", err);
  process.exit(1);
});
