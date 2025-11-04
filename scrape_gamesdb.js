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
  delayBetweenPages: 1000,
  delayBetweenDetails: 2000,
  maxRetries: 3,
  timeout: 30000
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
    console.log("📥 Starting basic game list scraping...");
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

        this.stats.basic.success += pageCount;
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

      // Debug: Log toàn bộ HTML để kiểm tra cấu trúc
      // console.log(`📄 HTML for game ${gameId}:`, html.substring(0, 2000));

      // Lấy thông tin cơ bản
      const title = $("h1").first().text().trim();
      console.log(`📝 Game ${gameId}: Title = "${title}"`);

      // Lấy Alternate Titles (Also Known As)
      let alternateTitles = "";
      $("h2").each((_, el) => {
        const heading = $(el).text().trim();
        if (heading.includes('Alternate Titles') || heading.includes('Also Known As')) {
          alternateTitles = $(el).next('p').text().trim();
          console.log(`🔄 Game ${gameId}: Alternate Titles = "${alternateTitles}"`);
        }
      });

      // Lấy thông tin từ bảng game-info - THỬ NHIỀU CÁCH KHÁC NHAU
      const gameInfo = {};
      
      // Cách 1: Tìm bảng theo class
      $('.game-info table tr, .table tr, table tr').each((_, row) => {
        const cells = $(row).find('td');
        if (cells.length >= 2) {
          const key = $(cells[0]).text().replace(':', '').trim();
          const value = $(cells[1]).text().trim();
          if (key && value) {
            gameInfo[key] = value;
            console.log(`📋 Game ${gameId}: ${key} = "${value}"`);
          }
        }
      });

      // Cách 2: Tìm theo text content nếu bảng không có class
      if (Object.keys(gameInfo).length === 0) {
        console.log(`🔍 Game ${gameId}: Trying alternative parsing method...`);
        
        // Tìm tất cả các thẻ có chứa thông tin game
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
          if (lowerText.includes('platform:')) {
            gameInfo['Platform'] = text.replace('Platform:', '').trim();
          }
        });
      }

      // Cách 3: Tìm theo cấu trúc phổ biến của game sites
      if (Object.keys(gameInfo).length === 0) {
        console.log(`🔍 Game ${gameId}: Trying common game site structure...`);
        
        // Giả sử thông tin nằm trong các thẻ <b> hoặc <strong>
        $('b, strong').each((_, el) => {
          const label = $(el).text().trim().replace(':', '');
          const value = $(el).parent().text().replace($(el).text(), '').trim();
          
          if (label && value && !value.includes('©') && value.length < 100) {
            const commonLabels = ['Developer', 'Publisher', 'Genre', 'Release Date', 'Players', 'Platform'];
            if (commonLabels.some(l => label.toLowerCase().includes(l.toLowerCase()))) {
              gameInfo[label] = value;
              console.log(`🏷️ Game ${gameId}: ${label} = "${value}"`);
            }
          }
        });
      }

      // Lấy mô tả
      let description = "";
      $("h2").each((_, el) => {
        const heading = $(el).text().trim();
        if (heading.includes('Description') || heading.includes('Overview')) {
          description = $(el).next('p').text().trim();
          console.log(`📖 Game ${gameId}: Description found (${description.length} chars)`);
        }
      });

      // Lấy rating (nếu có)
      const rating = $(".rating-value, .rating, [class*='rating']").first().text().trim();
      if (rating) {
        console.log(`⭐ Game ${gameId}: Rating = "${rating}"`);
      }

      console.log(`✅ Game ${gameId}: Scraped ${Object.keys(gameInfo).length} info fields`);

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
        description: description,
        scraped_at: new Date().toISOString(),
        // Thêm debug info
        _debug: {
          infoFields: Object.keys(gameInfo),
          infoCount: Object.keys(gameInfo).length
        }
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

    if (gameList.length === 0) {
      console.log("❌ No games to scrape details for.");
      return;
    }

    // Tạo CSV header với tất cả các trường cần thiết
    const detailedHeader = "id,title,alternate_titles,platform,publisher,developer,genre,release_date,region,players,rating,description,scraped_at,error\n";
    
    if (!fs.existsSync(DETAILED_FILE)) {
      fs.writeFileSync(DETAILED_FILE, detailedHeader);
    }

    const validGames = gameList.filter(game => game.id);
    this.stats.detailed.total = validGames.length;

    console.log(`🔍 Starting detailed scraping for ${validGames.length} valid games...`);

    // TEST: Chỉ scrape 5 game đầu tiên để kiểm tra
    const testGames = validGames.slice(0, 5);
    console.log(`🧪 TEST MODE: Scraping first ${testGames.length} games only`);

    for (let i = 0; i < testGames.length; i++) {
      const game = testGames[i];
      console.log(`\n🔍 [${i + 1}/${testGames.length}] Scraping details for: ${game.title} (ID: ${game.id})`);
      
      const details = await this.scrapeGameDetails(game.id);
      
      // Kết hợp thông tin cơ bản và chi tiết
      const combinedData = {
        ...game,
        ...details,
        basic_title: game.title,
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
        combinedData.release_date || game.release_date,
        combinedData.region || game.region,
        combinedData.players || "",
        combinedData.rating || "",
        combinedData.description || "",
        combinedData.scraped_at,
        combinedData.error || ""
      ].map(x => `"${String(x).replace(/"/g, '""')}"`).join(",") + "\n";
      
      fs.appendFileSync(DETAILED_FILE, csvRow);
      
      if (combinedData.error) {
        this.stats.detailed.errors++;
        console.log(`❌ Failed: ${game.title}`);
      } else {
        this.stats.detailed.success++;
        console.log(`✅ Success: ${game.title}`);
        console.log(`   📊 Info fields found: ${combinedData._debug?.infoCount || 0}`);
        console.log(`   🏢 Developer: ${combinedData.developer || 'N/A'}`);
        console.log(`   🏢 Publisher: ${combinedData.publisher || 'N/A'}`);
        console.log(`   🎮 Genre: ${combinedData.genre || 'N/A'}`);
        console.log(`   👥 Players: ${combinedData.players || 'N/A'}`);
      }
      
      // Delay giữa các request chi tiết
      if (i < testGames.length - 1) {
        const delay = CONFIG.delayBetweenDetails + Math.random() * 1000;
        console.log(`⏳ Waiting ${Math.round(delay/1000)}s before next request...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  saveBasicData(games) {
    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }
    
    const csvHeader = "id,title,region,release_date,platform,detail_url\n";
    const csvData = games
      .map(g => [g.id, g.title, g.region, g.release_date, g.platform, g.detail_url]
        .map(x => `"${String(x).replace(/"/g, '""')}"`)
        .join(","))
      .join("\n");

    fs.writeFileSync(BASIC_FILE, csvHeader + csvData);
    console.log(`💾 Basic data saved to: ${BASIC_FILE}`);
    console.log(`📝 Saved ${games.length} games to basic file`);
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
      
      // Bước 2: Scrape chi tiết từng game (TEST MODE - chỉ 5 game đầu)
      console.log("🚀 Starting DETAILED scraping (TEST MODE - 5 games)...");
      await this.scrapeAllDetails(basicGames);
      
      // Thống kê
      this.printStats();
      
      console.log("🎉 Test scraping completed! Check the CSV file for results.");
      console.log("📊 If all fields are populated correctly, remove the test limit to scrape all games.");
      
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
