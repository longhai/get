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
  maxPages: 2 // CHỈ TEST 3 TRANG
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

    while (page <= CONFIG.maxPages) {
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
            
            // Lấy ID từ link
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

      // Lấy thông tin từ HTML thực tế
      const title = $("h1").first().text().trim();
      console.log(`📝 Title: "${title}"`);

      // Lấy Alternate Titles (Also know as)
      let alternateTitles = "";
      const altTitlesElement = $("h6.text-muted");
      if (altTitlesElement.length > 0) {
        alternateTitles = altTitlesElement.text().replace('Also know as:', '').trim();
        console.log(`🔄 Alternate Titles: "${alternateTitles}"`);
      }

      // Lấy thông tin từ card bên trái
      const leftCard = $(".col-12.col-md-3.col-lg-2 .card.border-primary");
      
      // Platform
      let platform = "";
      const platformElement = leftCard.find("p:contains('Platform:')");
      if (platformElement.length > 0) {
        platform = platformElement.text().replace('Platform:', '').trim();
        console.log(`🎮 Platform: "${platform}"`);
      }

      // Region
      let region = "";
      const regionElement = leftCard.find("p:contains('Region:')");
      if (regionElement.length > 0) {
        region = regionElement.text().replace('Region:', '').trim();
        console.log(`🌍 Region: "${region}"`);
      }

      // Country
      let country = "";
      const countryElement = leftCard.find("p:contains('Country:')");
      if (countryElement.length > 0) {
        country = countryElement.text().replace('Country:', '').trim();
        console.log(`🇯🇵 Country: "${country}"`);
      }

      // Developer
      let developer = "";
      const developerElement = leftCard.find("p:contains('Developer(s):')");
      if (developerElement.length > 0) {
        developer = developerElement.text().replace('Developer(s):', '').trim();
        console.log(`🏢 Developer: "${developer}"`);
      }

      // Publisher
      let publisher = "";
      const publisherElement = leftCard.find("p:contains('Publishers(s):')");
      if (publisherElement.length > 0) {
        publisher = publisherElement.text().replace('Publishers(s):', '').trim();
        console.log(`🏢 Publisher: "${publisher}"`);
      }

      // Release Date
      let releaseDate = "";
      const releaseDateElement = leftCard.find("p:contains('ReleaseDate:')");
      if (releaseDateElement.length > 0) {
        releaseDate = releaseDateElement.text().replace('ReleaseDate:', '').trim();
        console.log(`📅 Release Date: "${releaseDate}"`);
      }

      // Players
      let players = "";
      const playersElement = leftCard.find("p:contains('Players:')");
      if (playersElement.length > 0) {
        players = playersElement.text().replace('Players:', '').trim();
        console.log(`👥 Players: "${players}"`);
      }

      // Co-op
      let coop = "";
      const coopElement = leftCard.find("p:contains('Co-op:')");
      if (coopElement.length > 0) {
        coop = coopElement.text().replace('Co-op:', '').trim();
        console.log(`🤝 Co-op: "${coop}"`);
      }

      // Lấy thông tin từ card chính (bên phải)
      const mainCard = $(".col-12.col-md-9.col-lg-8 .card.border-primary").first();

      // Description
      let description = "";
      const descriptionElement = mainCard.find(".game-overview");
      if (descriptionElement.length > 0) {
        description = descriptionElement.text().trim();
        console.log(`📖 Description: ${description.length} chars`);
      }

      // ESRB Rating
      let esrbRating = "";
      const esrbElement = mainCard.find("p:contains('ESRB Rating:')");
      if (esrbElement.length > 0) {
        esrbRating = esrbElement.text().replace('ESRB Rating:', '').trim();
        console.log(`📊 ESRB Rating: "${esrbRating}"`);
      }

      // Genre
      let genre = "";
      const genreElement = mainCard.find("p:contains('Genre(s):')");
      if (genreElement.length > 0) {
        genre = genreElement.text().replace('Genre(s):', '').trim();
        console.log(`🎯 Genre: "${genre}"`);
      }

      return {
        id: gameId,
        title,
        alternate_titles: alternateTitles,
        platform: platform || PLATFORM_NAME,
        region,
        country,
        publisher,
        developer,
        release_date: releaseDate,
        players,
        coop,
        genre,
        esrb_rating: esrbRating,
        description,
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
    
    // CSV header với tất cả các trường từ HTML thực tế
    const csvHeader = "id,title,alternate_titles,platform,region,country,publisher,developer,release_date,players,coop,genre,esrb_rating,description,detail_url,scraped_at,error\n";
    
    const csvData = games
      .map(g => [
        g.id,
        g.title || "",
        g.alternate_titles || "",
        g.platform || "",
        g.region || "",
        g.country || "",
        g.publisher || "",
        g.developer || "",
        g.release_date || "",
        g.players || "",
        g.coop || "",
        g.genre || "",
        g.esrb_rating || "",
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
