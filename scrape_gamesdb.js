import fs from "fs";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const BASE_URL = "https://thegamesdb.net/list_games.php";
const PLATFORM_ID = 7; // NES
const PLATFORM_NAME = "NES";
const OUTPUT_DIR = "data";
const OUTPUT_FILE = `${OUTPUT_DIR}/${PLATFORM_NAME}.csv`;

// Config
const CONFIG = {
  delayBetweenPages: 1000,
  delayBetweenDetails: 2000,
  maxRetries: 3,
  timeout: 30000,
  maxPages: 3 // CHỈ TEST 3 TRANG
};

class GameScraper {
  constructor() {
    this.stats = {
      total: 0,
      success: 0,
      errors: 0
    };
  }

  async fetchWithRetry(url, retries = CONFIG.maxRetries) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), CONFIG.timeout);
        
        const res = await fetch(url, { 
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
          }
        });
        clearTimeout(timeoutId);
        
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.text();
        
      } catch (error) {
        console.warn(`⚠️ Attempt ${attempt}/${retries} failed for ${url}: ${error.message}`);
        if (attempt === retries) throw error;
        
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
  }

  async scrapeGameIds(platformId) {
    console.log("📥 Scraping game IDs from list...");
    let page = 1;
    let gameIds = [];

    while (page <= CONFIG.maxPages) { // CHỈ 3 TRANG
      const url = `${BASE_URL}?platform_id=${platformId}&page=${page}`;
      console.log(`🔹 Fetching page ${page}: ${url}`);
      
      try {
        const html = await this.fetchWithRetry(url);
        const $ = cheerio.load(html);

        const cards = $(".col-6.col-md-2 .card.border-primary");
        console.log(`🎯 Found ${cards.length} cards on page ${page}`);
        
        if (cards.length === 0) {
          console.log("📭 No more cards found, stopping.");
          break;
        }

        let pageCount = 0;
        cards.each((_, el) => {
          try {
            const $card = $(el);
            
            // CHỈ LẤY ID từ link
            const gameLink = $card.closest('a').attr('href');
            let id = "";
            if (gameLink) {
              const idMatch = gameLink.match(/[?&]id=(\d+)/);
              if (idMatch) {
                id = idMatch[1];
                gameIds.push(id);
                pageCount++;
                console.log(`🎮 Found ID: ${id}`);
              }
            }

          } catch (cardError) {
            console.warn(`⚠️ Error processing card: ${cardError.message}`);
          }
        });

        console.log(`✅ Page ${page}: Found ${pageCount} game IDs`);

        // Kiểm tra có trang tiếp theo không
        const hasNext = $('a.page-link:contains("Next")').length > 0;
        console.log(`🔍 Next page available: ${hasNext}`);
        
        if (!hasNext) {
          console.log("⏹️ No next page, stopping.");
          break;
        }
        
        page++;
        
        // Delay giữa các trang
        await new Promise(resolve => setTimeout(resolve, CONFIG.delayBetweenPages));
        
      } catch (error) {
        console.error(`❌ Error on page ${page}:`, error.message);
        break;
      }
    }

    console.log(`📋 Total game IDs found: ${gameIds.length}`);
    return gameIds;
  }

  async scrapeGameDetails(gameId) {
    const url = `https://thegamesdb.net/game.php?id=${gameId}`;
    
    try {
      console.log(`🔍 Fetching details for game ${gameId}...`);
      const html = await this.fetchWithRetry(url);
      const $ = cheerio.load(html);

      // Lấy thông tin cơ bản
      const title = $("h1").first().text().trim();
      console.log(`📝 Game ${gameId}: "${title}"`);

      // Lấy Alternate Titles (Also Known As)
      let alternateTitles = "";
      $("h2").each((_, el) => {
        const heading = $(el).text().trim();
        if (heading.includes('Alternate Titles') || heading.includes('Also Known As')) {
          alternateTitles = $(el).next('p').text().trim();
          console.log(`🔄 Alt Titles: "${alternateTitles}"`);
        }
      });

      // Lấy thông tin từ bảng game-info
      const gameInfo = {};
      
      $('.game-info table tr, .table tr, table tr').each((_, row) => {
        const cells = $(row).find('td');
        if (cells.length >= 2) {
          const key = $(cells[0]).text().replace(':', '').trim();
          const value = $(cells[1]).text().trim();
          if (key && value) {
            gameInfo[key] = value;
            console.log(`📋 ${key}: "${value}"`);
          }
        }
      });

      // Lấy mô tả
      let description = "";
      $("h2").each((_, el) => {
        const heading = $(el).text().trim();
        if (heading.includes('Description') || heading.includes('Overview')) {
          description = $(el).next('p').text().trim();
          console.log(`📖 Description: ${description.length} chars`);
        }
      });

      // Lấy rating (nếu có)
      const rating = $(".rating-value, .rating, [class*='rating']").first().text().trim();
      if (rating) {
        console.log(`⭐ Rating: "${rating}"`);
      }

      return {
        id: gameId,
        title,
        alternate_titles: alternateTitles,
        platform: gameInfo.Platform || gameInfo.platform || PLATFORM_NAME,
        publisher: gameInfo.Publisher || gameInfo.publisher || "",
        developer: gameInfo.Developer || gameInfo.developer || "",
        genre: gameInfo.Genre || gameInfo.genre || "",
        release_date: gameInfo["Release Date"] || gameInfo["Release"] || gameInfo["Released"] || "",
        region: gameInfo.Region || gameInfo.region || "",
        players: gameInfo.Players || gameInfo.players || "",
        rating: rating || "",
        description: description,
        detail_url: url,
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

  async scrapeAllGames(gameIds) {
    console.log("📥 Starting detailed game scraping...");
    console.log(`📋 Total games to scrape: ${gameIds.length}`);

    if (gameIds.length === 0) {
      console.log("❌ No game IDs found to scrape.");
      return [];
    }

    const allGames = [];
    this.stats.total = gameIds.length;

    console.log(`🔍 Scraping details for ${gameIds.length} games...`);

    for (let i = 0; i < gameIds.length; i++) {
      const gameId = gameIds[i];
      console.log(`\n🔍 [${i + 1}/${gameIds.length}] Scraping game ID: ${gameId}`);
      
      const gameDetails = await this.scrapeGameDetails(gameId);
      allGames.push(gameDetails);
      
      if (gameDetails.error) {
        this.stats.errors++;
        console.log(`❌ Failed: ${gameId}`);
      } else {
        this.stats.success++;
        console.log(`✅ Success: ${gameDetails.title}`);
      }
      
      // Progress tracking
      const progress = ((i + 1) / gameIds.length * 100).toFixed(1);
      console.log(`📊 Progress: ${i + 1}/${gameIds.length} (${progress}%) | ✅ ${this.stats.success} | ❌ ${this.stats.errors}`);
      
      // Delay giữa các request chi tiết
      if (i < gameIds.length - 1) {
        const delay = CONFIG.delayBetweenDetails + Math.random() * 1000;
        console.log(`⏳ Waiting ${Math.round(delay/1000)}s...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    return allGames;
  }

  saveGameData(games) {
    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }
    
    // CSV header với tất cả các trường từ trang chi tiết
    const csvHeader = "id,title,alternate_titles,platform,publisher,developer,genre,release_date,region,players,rating,description,detail_url,scraped_at,error\n";
    
    const csvData = games
      .map(g => [
        g.id,
        g.title || "",
        g.alternate_titles || "",
        g.platform || "",
        g.publisher || "",
        g.developer || "",
        g.genre || "",
        g.release_date || "",
        g.region || "",
        g.players || "",
        g.rating || "",
        g.description || "",
        g.detail_url || "",
        g.scraped_at,
        g.error || ""
      ].map(x => `"${String(x).replace(/"/g, '""')}"`).join(","))
      .join("\n");

    fs.writeFileSync(OUTPUT_FILE, csvHeader + csvData);
    console.log(`💾 Game data saved to: ${OUTPUT_FILE}`);
    console.log(`📝 Saved ${games.length} games with complete details`);
  }

  printStats() {
    console.log("\n📈 ===== SCRAPING STATISTICS =====");
    console.log(`🎮 Total Games: ${this.stats.total}`);
    console.log(`✅ Success: ${this.stats.success}`);
    console.log(`❌ Errors: ${this.stats.errors}`);
    console.log(`📄 Output File: ${OUTPUT_FILE}`);
    console.log("====================================\n");
  }

  async run() {
    console.log(`🎮 Starting ${PLATFORM_NAME} GamesDB Scraper...\n`);
    console.log(`🧪 TEST MODE: Only ${CONFIG.maxPages} pages\n`);
    
    try {
      // Bước 1: Chỉ lấy ID từ danh sách
      const gameIds = await this.scrapeGameIds(PLATFORM_ID);
      
      if (gameIds.length === 0) {
        console.log("❌ No game IDs found. Exiting.");
        return;
      }
      
      // Bước 2: Scrape chi tiết cho tất cả game từ ID
      const allGames = await this.scrapeAllGames(gameIds);
      
      // Bước 3: Lưu toàn bộ dữ liệu vào CSV
      this.saveGameData(allGames);
      
      // Thống kê
      this.printStats();
      
      console.log("🎉 All scraping completed successfully!");
      
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

process.on('SIGINT', () => {
  console.log('\n🛑 Scraping interrupted by user');
  process.exit(0);
});

main().catch(err => {
  console.error("💥 Fatal error:", err);
  process.exit(1);
});
