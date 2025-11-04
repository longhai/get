import fs from "fs";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const BASE_URL = "https://thegamesdb.net/list_games.php";
const OUTPUT_DIR = "data";

const CONFIG = {
  delayBetweenPages: 500,
  delayBetweenDetails: 100,
  maxRetries: 3,
  timeout: 30000,
  maxPages: 3,
  concurrency: 5
};

class GameScraper {
  constructor(platformId) {
    this.platformId = platformId;
    this.stats = { total: 0, success: 0, errors: 0 };
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
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        });
        clearTimeout(timeoutId);
        
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.text();
        
      } catch (error) {
        console.warn(`⚠️ Attempt ${attempt}/${retries} failed: ${error.message}`);
        if (attempt === retries) throw error;
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
  }

  async scrapeGameIds() {
    console.log(`📥 Scraping platform ${this.platformId}...`);
    let page = 1;
    let gameIds = [];

    while (page <= CONFIG.maxPages) {
      const url = `${BASE_URL}?platform_id=${this.platformId}&page=${page}`;
      console.log(`🔹 Page ${page}: ${url}`);
      
      try {
        const html = await this.fetchWithRetry(url);
        const $ = cheerio.load(html);

        // Lấy tên platform từ trang đầu
        if (page === 1) {
          const platformElement = $(".card-header legend");
          if (platformElement.length > 0) {
            this.platformName = platformElement.text().trim().replace(/\s+/g, ' ');
            console.log(`🎮 Platform: "${this.platformName}"`);
          }
        }

        const cards = $(".col-6.col-md-2 .card.border-primary");
        if (cards.length === 0) break;

        cards.each((_, el) => {
          const gameLink = $(el).closest('a').attr('href');
          const idMatch = gameLink?.match(/[?&]id=(\d+)/);
          if (idMatch) gameIds.push(idMatch[1]);
        });

        console.log(`✅ Page ${page}: Found ${cards.length} games`);

        const hasNext = $('a.page-link:contains("Next")').length > 0;
        if (!hasNext) break;
        
        page++;
        await new Promise(resolve => setTimeout(resolve, CONFIG.delayBetweenPages));
        
      } catch (error) {
        console.error(`❌ Page ${page} error:`, error.message);
        break;
      }
    }

    console.log(`📋 Total IDs: ${gameIds.length}`);
    return gameIds;
  }

  async scrapeGameDetails(gameId) {
    const url = `https://thegamesdb.net/game.php?id=${gameId}`;
    
    try {
      const html = await this.fetchWithRetry(url);
      const $ = cheerio.load(html);

      const getText = (selector, replaceText = '') => 
        $(selector).text().replace(replaceText, '').trim();

      const leftCard = $(".col-12.col-md-3.col-lg-2 .card.border-primary");
      const mainCard = $(".col-12.col-md-9.col-lg-8 .card.border-primary").first();

      const gameData = {
        title: getText("h1"),
        alternate_titles: getText("h6.text-muted", 'Also know as:'),
        region: getText(leftCard, "p:contains('Region:')", 'Region:'),
        country: getText(leftCard, "p:contains('Country:')", 'Country:'),
        publisher: getText(leftCard, "p:contains('Publishers(s):')", 'Publishers(s):'),
        developer: getText(leftCard, "p:contains('Developer(s):')", 'Developer(s):'),
        release_date: getText(leftCard, "p:contains('ReleaseDate:')", 'ReleaseDate:'),
        players: getText(leftCard, "p:contains('Players:')", 'Players:'),
        coop: getText(leftCard, "p:contains('Co-op:')", 'Co-op:'),
        genre: getText(mainCard, "p:contains('Genre(s):')", 'Genre(s):'),
        esrb_rating: getText(mainCard, "p:contains('ESRB Rating:')", 'ESRB Rating:'),
        description: mainCard.find(".game-overview").text().trim()
      };

      console.log(`✅ ${gameData.title}`);
      return gameData;
      
    } catch (error) {
      console.error(`❌ Game ${gameId}:`, error.message);
      return { error: error.message };
    }
  }

  async scrapeAllGames(gameIds) {
    console.log(`\n📥 Scraping ${gameIds.length} games...`);
    console.log(`⚡ Concurrency: ${CONFIG.concurrency}\n`);

    this.stats.total = gameIds.length;
    const allGames = [];

    // Chia thành batches
    const batches = [];
    for (let i = 0; i < gameIds.length; i += CONFIG.concurrency) {
      batches.push(gameIds.slice(i, i + CONFIG.concurrency));
    }

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      console.log(`🔧 Batch ${i + 1}/${batches.length} (${batch.length} games)`);
      
      const promises = batch.map(gameId => 
        this.scrapeGameDetails(gameId)
          .then(result => {
            if (!result.error) this.stats.success++;
            return result;
          })
          .catch(error => {
            this.stats.errors++;
            return { error: error.message };
          })
      );

      const results = await Promise.all(promises);
      const validGames = results.filter(game => !game.error);
      allGames.push(...validGames);

      const progress = (allGames.length / this.stats.total * 100).toFixed(1);
      console.log(`📊 ${allGames.length}/${this.stats.total} (${progress}%) | ✅ ${this.stats.success} | ❌ ${this.stats.errors}`);

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

    // Tên file từ platform name
    const cleanName = this.platformName.replace(/[<>:"/\\|?*]/g, '').trim();
    const outputFile = `${OUTPUT_DIR}/${cleanName}.csv`;
    
    // CSV header KHÔNG CÓ platform
    const csvHeader = "title,alternate_titles,region,country,publisher,developer,release_date,players,coop,genre,esrb_rating,description\n";
    
    const csvData = games.map(g => [
      g.title, g.alternate_titles, g.region, g.country, g.publisher,
      g.developer, g.release_date, g.players, g.coop, g.genre,
      g.esrb_rating, g.description
    ].map(x => `"${String(x).replace(/"/g, '""')}"`).join(",")).join("\n");

    fs.writeFileSync(outputFile, csvHeader + csvData);
    console.log(`💾 Saved ${games.length} games to: ${outputFile}`);
    
    return outputFile;
  }

  printStats() {
    console.log(`\n📈 ${this.platformName} Statistics`);
    console.log(`📋 Total: ${this.stats.total} | ✅ ${this.stats.success} | ❌ ${this.stats.errors}`);
  }

  async run() {
    console.log(`\n🎮 Starting Platform ${this.platformId}...`);
    
    try {
      const gameIds = await this.scrapeGameIds();
      if (gameIds.length === 0) return;

      const games = await this.scrapeAllGames(gameIds);
      const outputFile = this.saveGameData(games);
      
      this.printStats();
      console.log(`🎉 Completed: ${outputFile}`);
      
    } catch (error) {
      console.error("💥 Fatal error:", error);
    }
  }
}

// Hàm helper để lấy text
function getText($, selector, replaceText = '') {
  const element = $(selector);
  return element.length > 0 ? element.text().replace(replaceText, '').trim() : "";
}

// Chạy nhiều platform
async function main() {
  const PLATFORMS = [6, 7]; // Thêm platform IDs ở đây
  
  for (const platformId of PLATFORMS) {
    const scraper = new GameScraper(platformId);
    await scraper.run();
    
    // Delay giữa các platform
    if (platformId !== PLATFORMS[PLATFORMS.length - 1]) {
      console.log(`\n⏳ Waiting before next platform...\n`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  console.log(`\n🎊 All platforms completed!`);
}

process.on('SIGINT', () => {
  console.log('\n🛑 Stopped by user');
  process.exit(0);
});

main().catch(err => {
  console.error("💥 Fatal error:", err);
  process.exit(1);
});
