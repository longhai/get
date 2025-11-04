import fs from "fs";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const BASE_URL = "https://thegamesdb.net/list_games.php";
const PLATFORMS = [6, 7]; // Chỉ cần ID
const OUTPUT_DIR = "data";

const CONFIG = {
  delay: 100,
  retries: 3,
  timeout: 30000,
  concurrency: 10
};

class GameScraper {
  constructor() {
    this.stats = { success: 0, errors: 0 };
  }

  async fetchWithRetry(url) {
    for (let attempt = 1; attempt <= CONFIG.retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), CONFIG.timeout);
        const res = await fetch(url, { 
          signal: controller.signal,
          headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        clearTimeout(timeoutId);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.text();
      } catch (error) {
        if (attempt === CONFIG.retries) throw error;
        await new Promise(r => setTimeout(r, 1000 * attempt));
      }
    }
  }

  async scrapeGameIds(platformId) {
    let page = 1, gameIds = [], platformName = "";

    while (true) {
      const url = `${BASE_URL}?platform_id=${platformId}&page=${page}`;
      console.log(`🔹 P${platformId} Page ${page}`);
      
      try {
        const html = await this.fetchWithRetry(url);
        const $ = cheerio.load(html);

        if (!platformName) {
          platformName = $(".card-header legend").text().trim();
          console.log(`🎮 ${platformName}`);
        }

        const cards = $(".col-6.col-md-2 .card.border-primary");
        if (cards.length === 0) break;

        cards.each((_, el) => {
          const idMatch = $(el).closest('a').attr('href')?.match(/[?&]id=(\d+)/);
          if (idMatch) gameIds.push(idMatch[1]);
        });

        const hasNext = $('a.page-link:contains("Next")').length > 0;
        if (!hasNext) break;
        
        page++;
        await new Promise(r => setTimeout(r, CONFIG.delay));
        
      } catch (error) {
        console.error(`❌ Page ${page}:`, error.message);
        break;
      }
    }

    console.log(`📋 Found ${gameIds.length} games`);
    return { gameIds, platformName };
  }

  async scrapeGameDetails(gameId, platformName) {
    try {
      const html = await this.fetchWithRetry(`https://thegamesdb.net/game.php?id=${gameId}`);
      const $ = cheerio.load(html);

      const title = $("h1").first().text().trim();
      const altTitles = $("h6.text-muted").text().replace('Also know as:', '').trim();
      
      const leftCard = $(".col-12.col-md-3.col-lg-2 .card.border-primary");
      const get = (text) => leftCard.find(`p:contains('${text}')`).text().replace(`${text}:`, '').trim();

      const mainCard = $(".col-12.col-md-9.col-lg-8 .card.border-primary").first();
      const description = mainCard.find(".game-overview").text().trim();
      const genre = mainCard.find("p:contains('Genre(s):')").text().replace('Genre(s):', '').trim();
      const esrb = mainCard.find("p:contains('ESRB Rating:')").text().replace('ESRB Rating:', '').trim();

      console.log(`✅ ${title}`);

      return {
        title,
        alternate_titles: altTitles,
        platform: platformName,
        region: get('Region'),
        country: get('Country'),
        publisher: get('Publishers(s)'),
        developer: get('Developer(s)'),
        release_date: get('ReleaseDate'),
        players: get('Players'),
        coop: get('Co-op'),
        genre,
        esrb_rating: esrb,
        description
      };
      
    } catch (error) {
      console.error(`❌ ${gameId}:`, error.message);
      return { error: error.message };
    }
  }

  async scrapePlatform(platformId) {
    console.log(`\n🎯 Platform ${platformId}`);
    
    const { gameIds, platformName } = await this.scrapeGameIds(platformId);
    if (gameIds.length === 0) return null;

    console.log(`⚡ Scraping ${gameIds.length} games...`);

    const allGames = [];
    for (let i = 0; i < gameIds.length; i += CONFIG.concurrency) {
      const batch = gameIds.slice(i, i + CONFIG.concurrency);
      const promises = batch.map(id => this.scrapeGameDetails(id, platformName));
      const results = await Promise.allSettled(promises);
      
      const validGames = results
        .filter(r => r.status === 'fulfilled' && !r.value.error)
        .map(r => r.value);
      
      allGames.push(...validGames);
      this.stats.success += validGames.length;
      this.stats.errors += results.length - validGames.length;

      console.log(`📊 ${platformName}: ${allGames.length}/${gameIds.length}`);
      if (i + CONFIG.concurrency < gameIds.length) {
        await new Promise(r => setTimeout(r, CONFIG.delay));
      }
    }

    return { platformName, games: allGames };
  }

  savePlatformData(platformName, games) {
    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    const fileName = platformName.replace(/[<>:"/\\|?*]/g, '').trim();
    const filePath = `${OUTPUT_DIR}/${fileName}.csv`;
    
    const header = "title,alternate_titles,platform,region,country,publisher,developer,release_date,players,coop,genre,esrb_rating,description\n";
    const rows = games.map(g => [
      g.title, g.alternate_titles, g.platform, g.region, g.country,
      g.publisher, g.developer, g.release_date, g.players, g.coop,
      g.genre, g.esrb_rating, g.description
    ].map(x => `"${String(x).replace(/"/g, '""')}"`).join(","));

    fs.writeFileSync(filePath, header + rows.join("\n"));
    console.log(`💾 ${games.length} games -> ${filePath}`);
  }

  async run() {
    console.log("🎮 Starting Scraper\n");
    
    for (const platformId of PLATFORMS) {
      const result = await this.scrapePlatform(platformId);
      if (result) this.savePlatformData(result.platformName, result.games);
    }

    console.log(`\n🎉 Done! ✅ ${this.stats.success} ❌ ${this.stats.errors}`);
  }
}

// Chạy
async function main() {
  await new GameScraper().run();
}

process.on('SIGINT', () => {
  console.log('\n🛑 Stopped');
  process.exit(0);
});

main().catch(console.error);
