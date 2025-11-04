import fs from "fs";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const BASE_URL = "https://thegamesdb.net/list_games.php";
const OUTPUT_DIR = "data";

// Config
const CONFIG = {
  delayBetweenPages: 500,
  delayBetweenDetails: 100,
  maxRetries: 3,
  timeout: 30000,
  concurrency: 5 // Số request song song
};

class GameScraper {
  constructor(platformId) {
    this.stats = {
      total: 0,
      success: 0,
      errors: 0
    };
    this.platformId = platformId;
    this.platformName = "";
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

  async scrapeGameIds() {
    console.log(`📥 Scraping game IDs for platform ${this.platformId}...`);
    let page = 1;
    let gameIds = [];

    while (true) { // BỎ GIỚI HẠN SỐ TRANG
      const url = `${BASE_URL}?platform_id=${this.platformId}&page=${page}`;
      console.log(`🔹 Fetching page ${page}: ${url}`);
      
      try {
        const html = await this.fetchWithRetry(url);
        const $ = cheerio.load(html);

        // Lấy tên platform từ trang đầu tiên
        if (page === 1) {
          const platformElement = $(".card-header legend");
          if (platformElement.length > 0) {
            // Lấy text và loại bỏ ảnh
            let platformText = platformElement.text().trim();
            // Loại bỏ khoảng trắng thừa
            platformText = platformText.replace(/\s+/g, ' ').trim();
            
            if (platformText) {
              this.platformName = platformText;
              console.log(`🎮 Platform detected: "${this.platformName}"`);
            }
          }
        }

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
              }
            }

          } catch (cardError) {
            console.warn(`⚠️ Error processing card: ${cardError.message}`);
          }
        });

        console.log(`✅ Page ${page}: Found ${pageCount} game IDs`);

        // Kiểm tra có trang tiếp theo không
        const hasNext = $('a.page-link:contains("Next")').length > 0;
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
      const html = await this.fetchWithRetry(url);
      const $ = cheerio.load(html);

      // Lấy thông tin từ HTML thực tế
      const title = $("h1").first().text().trim();

      // Lấy Alternate Titles (Also know as)
      let alternateTitles = "";
      const altTitlesElement = $("h6.text-muted");
      if (altTitlesElement.length > 0) {
        alternateTitles = altTitlesElement.text().replace('Also know as:', '').trim();
      }

      // Lấy thông tin từ card bên trái
      const leftCard = $(".col-12.col-md-3.col-lg-2 .card.border-primary");
      
      // Platform - luôn dùng platformName đã detect
      const platform = this.platformName;

      // Region
      let region = "";
      const regionElement = leftCard.find("p:contains('Region:')");
      if (regionElement.length > 0) {
        region = regionElement.text().replace('Region:', '').trim();
      }

      // Country
      let country = "";
      const countryElement = leftCard.find("p:contains('Country:')");
      if (countryElement.length > 0) {
        country = countryElement.text().replace('Country:', '').trim();
      }

      // Developer
      let developer = "";
      const developerElement = leftCard.find("p:contains('Developer(s):')");
      if (developerElement.length > 0) {
        developer = developerElement.text().replace('Developer(s):', '').trim();
      }

      // Publisher
      let publisher = "";
      const publisherElement = leftCard.find("p:contains('Publishers(s):')");
      if (publisherElement.length > 0) {
        publisher = publisherElement.text().replace('Publishers(s):', '').trim();
      }

      // Release Date
      let releaseDate = "";
      const releaseDateElement = leftCard.find("p:contains('ReleaseDate:')");
      if (releaseDateElement.length > 0) {
        releaseDate = releaseDateElement.text().replace('ReleaseDate:', '').trim();
      }

      // Players
      let players = "";
      const playersElement = leftCard.find("p:contains('Players:')");
      if (playersElement.length > 0) {
        players = playersElement.text().replace('Players:', '').trim();
      }

      // Co-op
      let coop = "";
      const coopElement = leftCard.find("p:contains('Co-op:')");
      if (coopElement.length > 0) {
        coop = coopElement.text().replace('Co-op:', '').trim();
      }

      // Lấy thông tin từ card chính (bên phải)
      const mainCard = $(".col-12.col-md-9.col-lg-8 .card.border-primary").first();

      // Description
      let description = "";
      const descriptionElement = mainCard.find(".game-overview");
      if (descriptionElement.length > 0) {
        description = descriptionElement.text().trim();
      }

      // ESRB Rating
      let esrbRating = "";
      const esrbElement = mainCard.find("p:contains('ESRB Rating:')");
      if (esrbElement.length > 0) {
        esrbRating = esrbElement.text().replace('ESRB Rating:', '').trim();
      }

      // Genre
      let genre = "";
      const genreElement = mainCard.find("p:contains('Genre(s):')");
      if (genreElement.length > 0) {
        genre = genreElement.text().replace('Genre(s):', '').trim();
      }

      console.log(`✅ Scraped: ${title}`);

      return {
        title: title || "",
        alternate_titles: alternateTitles || "",
        platform: platform || "",
        region: region || "",
        country: country || "",
        publisher: publisher || "",
        developer: developer || "",
        release_date: releaseDate || "",
        players: players || "",
        coop: coop || "",
        genre: genre || "",
        esrb_rating: esrbRating || "",
        description: description || ""
      };
      
    } catch (error) {
      console.error(`❌ Error scraping game ${gameId}:`, error.message);
      return {
        error: error.message
      };
    }
  }

  async processBatch(gameIds, batchNumber) {
    console.log(`\n🔧 Processing batch ${batchNumber} with ${gameIds.length} games...`);
    
    const promises = gameIds.map(gameId => 
      this.scrapeGameDetails(gameId)
        .then(result => {
          this.stats.success++;
          return result;
        })
        .catch(error => {
          this.stats.errors++;
          console.error(`❌ Failed to scrape game ${gameId}:`, error.message);
          return { error: error.message };
        })
    );

    const results = await Promise.all(promises);
    return results.filter(game => !game.error);
  }

  async scrapeAllGamesParallel(gameIds) {
    console.log("📥 Starting PARALLEL game scraping...");
    console.log(`📋 Total games to scrape: ${gameIds.length}`);
    console.log(`⚡ Concurrency: ${CONFIG.concurrency} requests at once\n`);

    if (gameIds.length === 0) {
      console.log("❌ No game IDs found to scrape.");
      return [];
    }

    this.stats.total = gameIds.length;
    const allGames = [];

    // Chia thành các batch nhỏ
    const batches = [];
    for (let i = 0; i < gameIds.length; i += CONFIG.concurrency) {
      batches.push(gameIds.slice(i, i + CONFIG.concurrency));
    }

    console.log(`🔄 Processing ${batches.length} batches...`);

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const batchResults = await this.processBatch(batch, i + 1);
      allGames.push(...batchResults);

      // Progress tracking
      const processed = allGames.length;
      const progress = (processed / this.stats.total * 100).toFixed(1);
      console.log(`📊 Progress: ${processed}/${this.stats.total} (${progress}%) | ✅ ${this.stats.success} | ❌ ${this.stats.errors}`);

      // Delay giữa các batch
      if (i < batches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, CONFIG.delayBetweenDetails));
      }
    }

    return allGames;
  }

  saveGameData(games) {
    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    // Tạo tên file từ platform name (giữ nguyên tên, chỉ thay thế ký tự không hợp lệ)
    const cleanPlatformName = this.platformName
      .replace(/[<>:"/\\|?*]/g, '') // Loại bỏ ký tự không hợp lệ cho file name
      .replace(/\s+/g, ' ') // Chuẩn hóa khoảng trắng
      .trim();
    
    const outputFile = `${OUTPUT_DIR}/${cleanPlatformName}.csv`;
    
    console.log(`💾 Saving to: ${outputFile}`);
    
    // CSV header KHÔNG CÓ id, detail_url, scraped_at
    const csvHeader = "title,alternate_titles,platform,region,country,publisher,developer,release_date,players,coop,genre,esrb_rating,description\n";
    
    const csvData = games
      .map(g => [
        g.title,
        g.alternate_titles,
        g.platform,
        g.region,
        g.country,
        g.publisher,
        g.developer,
        g.release_date,
        g.players,
        g.coop,
        g.genre,
        g.esrb_rating,
        g.description
      ].map(x => `"${String(x).replace(/"/g, '""')}"`).join(","))
      .join("\n");

    fs.writeFileSync(outputFile, csvHeader + csvData);
    console.log(`✅ Saved ${games.length} games to: ${outputFile}`);
    
    return outputFile;
  }

  printStats() {
    console.log("\n📈 ===== SCRAPING STATISTICS =====");
    console.log(`🎮 Platform: ${this.platformName} (ID: ${this.platformId})`);
    console.log(`📋 Total Games: ${this.stats.total}`);
    console.log(`✅ Success: ${this.stats.success}`);
    console.log(`❌ Errors: ${this.stats.errors}`);
    console.log(`⚡ Concurrency: ${CONFIG.concurrency} requests`);
    console.log("====================================\n");
  }

  async run() {
    console.log(`🎮 Starting GamesDB Scraper for Platform ID: ${this.platformId}...\n`);
    console.log(`⚡ PARALLEL MODE: ${CONFIG.concurrency} concurrent requests\n`);
    
    try {
      // Bước 1: Chỉ lấy ID từ danh sách (và detect platform name)
      const gameIds = await this.scrapeGameIds();
      
      if (gameIds.length === 0) {
        console.log("❌ No game IDs found. Exiting.");
        return;
      }
      
      // Bước 2: Scrape chi tiết song song
      const allGames = await this.scrapeAllGamesParallel(gameIds);
      
      // Bước 3: Lưu dữ liệu vào CSV với tên platform
      const outputFile = this.saveGameData(allGames);
      
      // Thống kê
      this.printStats();
      
      console.log(`🎉 All scraping completed for ${this.platformName}!`);
      console.log(`📁 Output: ${outputFile}`);
      
    } catch (error) {
      console.error("💥 Fatal error in scraper:", error);
      process.exit(1);
    }
  }
}

// Chạy scraper cho nhiều platform
async function main() {
  // Danh sách platform IDs cần scrape
  const PLATFORMS = [
    { id: 7, name: "NES" },
    { id: 6, name: "Super Nintendo" }
  ];

  for (const platform of PLATFORMS) {
    console.log(`\n🎯 ===== SCRAPING ${platform.name.toUpperCase()} (ID: ${platform.id}) =====\n`);
    
    const scraper = new GameScraper(platform.id);
    await scraper.run();
    
    // Delay giữa các platform
    console.log(`⏳ Waiting before next platform...`);
    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  console.log(`\n🎉 ALL PLATFORMS COMPLETED!`);
  console.log(`📁 Check the 'data' folder for CSV files.`);
}

process.on('SIGINT', () => {
  console.log('\n🛑 Scraping interrupted by user');
  process.exit(0);
});

main().catch(err => {
  console.error("💥 Fatal error:", err);
  process.exit(1);
});
