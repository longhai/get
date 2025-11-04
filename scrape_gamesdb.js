import fs from "fs";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const BASE_URL = "https://thegamesdb.net/list_games.php";
const PLATFORM_IDS = [6, 7]; // Multiple platforms
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
  constructor() {
    this.stats = { total: 0, success: 0, errors: 0 };
  }

  async fetchWithRetry(url, retries = CONFIG.maxRetries) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), CONFIG.timeout);
        const res = await fetch(url, { 
          signal: controller.signal,
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });
        clearTimeout(timeoutId);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.text();
      } catch (error) {
        if (attempt === retries) throw error;
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
  }

  async scrapeGameIds(platformId) {
    console.log(`📥 Scraping platform ${platformId}...`);
    let page = 1, gameIds = [], platformName = "";

    while (page <= CONFIG.maxPages) {
      const url = `${BASE_URL}?platform_id=${platformId}&page=${page}`;
      console.log(`🔹 Page ${page}: ${url}`);
      
      try {
        const html = await this.fetchWithRetry(url);
        const $ = cheerio.load(html);

        if (page === 1 && !platformName) {
          platformName = $(".card-header legend").text().trim().replace(/\s+/g, ' ');
          console.log(`🎮 Platform: "${platformName}"`);
        }

        const cards = $(".col-6.col-md-2 .card.border-primary");
        if (cards.length === 0) break;

        cards.each((_, el) => {
          const gameLink = $(el).closest('a').attr('href');
          const idMatch = gameLink?.match(/[?&]id=(\d+)/);
          if (idMatch) gameIds.push(idMatch[1]);
        });

        console.log(`✅ Page ${page}: ${cards.length} games`);

        if ($('a.page-link:contains("Next")').length === 0) break;
        page++;
        await new Promise(resolve => setTimeout(resolve, CONFIG.delayBetweenPages));
      } catch (error) {
        console.error(`❌ Page ${page} error:`, error.message);
        break;
      }
    }

    console.log(`📋 Found ${gameIds.length} games\n`);
    return { gameIds, platformName };
  }

  async scrapeGameDetails(gameId) {
    try {
      const html = await this.fetchWithRetry(`https://thegamesdb.net/game.php?id=${gameId}`);
      const $ = cheerio.load(html);

      const leftCard = $(".col-12.col-md-3.col-lg-2 .card.border-primary");
      const mainCard = $(".col-12.col-md-9.col-lg-8 .card.border-primary").first();

      const getText = (selector, replaceText = '') => 
        $(selector).text().replace(replaceText, '').trim();

      return {
        title: $("h1").first().text().trim(),
        alternate_titles: getText("h6.text-muted", 'Also know as:'),
        region: getText(leftCard.find("p:contains('Region:')"), 'Region:'),
        country: getText(leftCard.find("p:contains('Country:')"), 'Country:'),
        publisher: getText(leftCard.find("p:contains('Publishers(s):')"), 'Publishers(s):'),
        developer: getText(leftCard.find("p:contains('Developer(s):')"), 'Developer(s):'),
        release_date: getText(leftCard.find("p:contains('ReleaseDate:')"), 'ReleaseDate:'),
        players: getText(leftCard.find("p:contains('Players:')"), 'Players:'),
        coop: getText(leftCard.find("p:contains('Co-op:')"), 'Co-op:'),
        genre: getText(mainCard.find("p:contains('Genre(s):')"), 'Genre(s):'),
        esrb_rating: getText(mainCard.find("p:contains('ESRB Rating:')"), 'ESRB Rating:'),
        description: mainCard.find(".game-overview").text().trim()
      };
    } catch (error) {
      console.error(`❌ Game ${gameId}:`, error.message);
      return { error: error.message };
    }
  }

  async scrapePlatform(platformId) {
    const { gameIds, platformName } = await this.scrapeGameIds(platformId);
    if (gameIds.length === 0) return null;

    console.log(`⚡ Scraping ${gameIds.length} games (${CONFIG.concurrency} concurrent)...`);
    
    const batches = [];
    for (let i = 0; i < gameIds.length; i += CONFIG.concurrency) {
      batches.push(gameIds.slice(i, i + CONFIG.concurrency));
    }

    const allGames = [];
    for (let i = 0; i < batches.length; i++) {
      const batchResults = await Promise.all(
        batches[i].map(gameId => 
          this.scrapeGameDetails(gameId)
            .then(result => (this.stats.success++, result))
            .catch(error => (this.stats.errors++, { error: error.message }))
        )
      );

      allGames.push(...batchResults.filter(game => !game.error));
      
      const progress = (allGames.length / gameIds.length * 100).toFixed(1);
      console.log(`📊 ${allGames.length}/${gameIds.length} (${progress}%)`);

      if (i < batches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, CONFIG.delayBetweenDetails));
      }
    }

    this.stats.total += gameIds.length;
    return { platformName, games: allGames };
  }

  savePlatformData(platformName, games) {
    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    const cleanName = platformName.replace(/[<>:"/\\|?*]/g, '').trim();
    const outputFile = `${OUTPUT_DIR}/${cleanName}.csv`;
    
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

  async run() {
    console.log(`🎮 Starting Scraper for ${PLATFORM_IDS.length} platforms...\n`);

    for (const platformId of PLATFORM_IDS) {
      console.log(`\n🔸 Processing Platform ID: ${platformId}`);
      const platformData = await this.scrapePlatform(platformId);
      
      if (platformData) {
        this.savePlatformData(platformData.platformName, platformData.games);
      }
    }

    console.log(`\n📈 Completed: ${this.stats.success}/${this.stats.total} games`);
    console.log(`❌ Errors: ${this.stats.errors}`);
  }
}

// Run
async function main() {
  await new GameScraper().run();
}

process.on('SIGINT', () => {
  console.log('\n🛑 Stopped by user');
  process.exit(0);
});

main().catch(console.error);
