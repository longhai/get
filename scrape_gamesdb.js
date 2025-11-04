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
  timeout: 30000
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

  async scrapeBasicList(platformId) {
    console.log("📥 Starting game list scraping...");
    let page = 1;
    let results = [];

    while (true) {
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
              }
            }

            if (!id) {
              console.log(`⚠️ Skipping card - no ID found in link: ${gameLink}`);
              return;
            }

            // Lấy thông tin từ card-footer
            const footer = $card.find(".card-footer");
            const title = footer.find("p").first().text().trim();
            
            // Lấy các thông tin khác từ các paragraph
            const paragraphs = footer.find("p");
            let region = "";
            let releaseDate = "";
            let platform = "";

            if (paragraphs.length >= 2) {
              // Paragraph thứ 2: Region info
              const regionHtml = $(paragraphs[1]).html() || "";
              region = regionHtml.split('<br>')[0].trim();
            }

            if (paragraphs.length >= 3) {
              // Paragraph thứ 3: Release Date
              releaseDate = $(paragraphs[2]).text().trim();
              releaseDate = releaseDate.replace('Release Date:', '').trim();
            }

            if (paragraphs.length >= 4) {
              // Paragraph thứ 4: Platform
              platform = $(paragraphs[3]).text().trim();
              platform = platform.replace('Platform:', '').trim();
            }

            const gameData = { 
              id, 
              title, 
              region, 
              release_date: releaseDate, 
              platform,
              detail_url: `https://thegamesdb.net/game.php?id=${id}`
            };
            
            results.push(gameData);
            pageCount++;
            console.log(`🎮 Found: ${title} (ID: ${id})`);
            
          } catch (cardError) {
            console.warn(`⚠️ Error processing card: ${cardError.message}`);
          }
        });

        console.log(`✅ Page ${page}: Processed ${pageCount} games`);

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

      // Lấy Alternate Titles (Also Known As)
      let alternateTitles = "";
      $("h2").each((_, el) => {
        const heading = $(el).text().trim();
        if (heading.includes('Alternate Titles') || heading.includes('Also Known As')) {
          alternateTitles = $(el).next('p').text().trim();
        }
      });

      // Lấy thông tin từ bảng game-info
      const gameInfo = {};
      
      // Cách 1: Tìm bảng theo class
      $('.game-info table tr, .table tr, table tr').each((_, row) => {
        const cells = $(row).find('td');
        if (cells.length >= 2) {
          const key = $(cells[0]).text().replace(':', '').trim();
          const value = $(cells[1]).text().trim();
          if (key && value) {
            gameInfo[key] = value;
          }
        }
      });

      // Cách 2: Tìm theo text content nếu bảng không có class
      if (Object.keys(gameInfo).length === 0) {
        $('p, div, span').each((_, el) => {
          const text = $(el).text().trim();
          const lowerText = text.toLowerCase();
          
          if (lowerText.includes('developer:')) {
            gameInfo['Developer'] = text.replace('Developer:', '').trim();
          }
          if (lowerText.includes('publisher:')) {
            gameInfo['Publisher'] = text.replace('Publisher:', '').trim();
          }
          if (lowerText.includes('genre:')) {
            gameInfo['Genre'] = text.replace('Genre:', '').trim();
          }
          if (lowerText.includes('release date:')) {
            gameInfo['Release Date'] = text.replace('Release Date:', '').trim();
          }
          if (lowerText.includes('players:')) {
            gameInfo['Players'] = text.replace('Players:', '').trim();
          }
        });
      }

      // Lấy mô tả
      let description = "";
      $("h2").each((_, el) => {
        const heading = $(el).text().trim();
        if (heading.includes('Description') || heading.includes('Overview')) {
          description = $(el).next('p').text().trim();
        }
      });

      // Lấy rating (nếu có)
      const rating = $(".rating-value, .rating, [class*='rating']").first().text().trim();

      return {
        id: gameId,
        title,
        alternate_titles: alternateTitles,
        platform: gameInfo.Platform || gameInfo.platform || "",
        publisher: gameInfo.Publisher || gameInfo.publisher || "",
        developer: gameInfo.Developer || gameInfo.developer || "",
        genre: gameInfo.Genre || gameInfo.genre || "",
        release_date: gameInfo["Release Date"] || gameInfo["Release"] || gameInfo["Released"] || "",
        region: gameInfo.Region || gameInfo.region || "",
        players: gameInfo.Players || gameInfo.players || "",
        rating: rating || "",
        description: description
      };
      
    } catch (error) {
      console.error(`❌ Error scraping game ${gameId}:`, error.message);
      return {
        id: gameId,
        error: error.message
      };
    }
  }

  async scrapeAllGamesWithDetails(gameList) {
    console.log("📥 Starting detailed game scraping...");
    console.log(`📋 Total games to scrape: ${gameList.length}`);

    if (gameList.length === 0) {
      console.log("❌ No games found to scrape.");
      return [];
    }

    const allGamesWithDetails = [];
    const validGames = gameList.filter(game => game.id);
    this.stats.total = validGames.length;

    console.log(`🔍 Starting detailed scraping for ${validGames.length} games...`);

    for (let i = 0; i < validGames.length; i++) {
      const basicGame = validGames[i];
      console.log(`\n🔍 [${i + 1}/${validGames.length}] Scraping: ${basicGame.title} (ID: ${basicGame.id})`);
      
      const details = await this.scrapeGameDetails(basicGame.id);
      
      // Kết hợp thông tin cơ bản và chi tiết
      const fullGameData = {
        // Thông tin cơ bản từ danh sách
        id: basicGame.id,
        title: basicGame.title,
        region: basicGame.region,
        release_date: basicGame.release_date,
        platform: basicGame.platform,
        detail_url: basicGame.detail_url,
        
        // Thông tin chi tiết từ trang game
        alternate_titles: details.alternate_titles || "",
        publisher: details.publisher || "",
        developer: details.developer || "",
        genre: details.genre || "",
        players: details.players || "",
        rating: details.rating || "",
        description: details.description || "",
        
        // Timestamp
        scraped_at: new Date().toISOString(),
        
        // Error info (nếu có)
        error: details.error || ""
      };
      
      allGamesWithDetails.push(fullGameData);
      
      if (details.error) {
        this.stats.errors++;
        console.log(`❌ Failed: ${basicGame.title}`);
      } else {
        this.stats.success++;
        console.log(`✅ Success: ${basicGame.title}`);
        console.log(`   🏢 Developer: ${fullGameData.developer || 'N/A'}`);
        console.log(`   🏢 Publisher: ${fullGameData.publisher || 'N/A'}`);
        console.log(`   🎮 Genre: ${fullGameData.genre || 'N/A'}`);
        console.log(`   👥 Players: ${fullGameData.players || 'N/A'}`);
        console.log(`   🔄 Alt Titles: ${fullGameData.alternate_titles || 'N/A'}`);
      }
      
      // Progress tracking
      const progress = ((i + 1) / validGames.length * 100).toFixed(1);
      console.log(`📊 Overall Progress: ${i + 1}/${validGames.length} (${progress}%) | ✅ ${this.stats.success} | ❌ ${this.stats.errors}`);
      
      // Delay giữa các request chi tiết
      if (i < validGames.length - 1) {
        const delay = CONFIG.delayBetweenDetails + Math.random() * 1000;
        console.log(`⏳ Waiting ${Math.round(delay/1000)}s...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    return allGamesWithDetails;
  }

  saveFullData(games) {
    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }
    
    // CSV header với tất cả các trường
    const csvHeader = "id,title,region,release_date,platform,alternate_titles,publisher,developer,genre,players,rating,description,detail_url,scraped_at,error\n";
    
    const csvData = games
      .map(g => [
        g.id,
        g.title,
        g.region,
        g.release_date,
        g.platform,
        g.alternate_titles,
        g.publisher,
        g.developer,
        g.genre,
        g.players,
        g.rating,
        g.description,
        g.detail_url,
        g.scraped_at,
        g.error
      ].map(x => `"${String(x).replace(/"/g, '""')}"`).join(","))
      .join("\n");

    fs.writeFileSync(OUTPUT_FILE, csvHeader + csvData);
    console.log(`💾 Full data saved to: ${OUTPUT_FILE}`);
    console.log(`📝 Saved ${games.length} games with complete details`);
  }

  printStats() {
    console.log("\n📈 ===== SCRAPING STATISTICS =====");
    console.log(`🎮 Total Games: ${this.stats.total}`);
    console.log(`✅ Success: ${this.stats.success}`);
    console.log(`❌ Errors: ${this.stats.errors}`);
    console.log(`💾 Output File: ${OUTPUT_FILE}`);
    console.log("====================================\n");
  }

  async run() {
    console.log(`🎮 Starting ${PLATFORM_NAME} GamesDB Scraper...\n`);
    
    try {
      // Bước 1: Scrape danh sách cơ bản
      const basicGames = await this.scrapeBasicList(PLATFORM_ID);
      
      if (basicGames.length === 0) {
        console.log("❌ No games found. Exiting.");
        return;
      }
      
      console.log(`📋 Found ${basicGames.length} games in basic list`);
      
      // Bước 2: Scrape chi tiết cho tất cả game
      const allGamesWithDetails = await this.scrapeAllGamesWithDetails(basicGames);
      
      // Bước 3: Lưu toàn bộ dữ liệu vào 1 CSV
      this.saveFullData(allGamesWithDetails);
      
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
