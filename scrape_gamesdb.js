import fs from "fs";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const BASE_URL = "https://thegamesdb.net/list_games.php";
const PLATFORM_IDS = [5, 6, 7, 10, 13, 18, 23, 24, 35, 36, 4925, 4930];
const OUTPUT_DIR = "data";

const CONFIG = {
  delayBetweenPages: 500,
  delayBetweenDetails: 100,
  maxRetries: 3,
  timeout: 30000,
  concurrency: 18
};

// Hàm đọc CSV xử lý chính xác dấu ngoặc kép và dấu phẩy
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
      
      console.log(`📚 Found ${existingTitles.size} existing unique titles in CSV`);
      return existingTitles;
    } catch (error) {
      console.log('❌ Error reading existing file, starting fresh');
      return new Set();
    }
  }

  async scrapeGameIds(platformId) {
    console.log(`📥 Scraping platform ${platformId}...`);
    let page = 1;
    const gameIdsSet = new Set(); // Dùng Set để lọc trùng ID ngay từ đầu
    let platformName = "";

    while (true) {
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
          if (idMatch) gameIdsSet.add(idMatch[1]);
        });

        console.log(`✅ Page ${page}: ${cards.length} cards found`);

        if ($('a.page-link:contains("Next")').length === 0) break;
        page++;
        await new Promise(resolve => setTimeout(resolve, CONFIG.delayBetweenPages));
      } catch (error) {
        console.error(`❌ Page ${page} error:`, error.message);
        break;
      }
    }

    const gameIds = Array.from(gameIdsSet);
    console.log(`📋 Found ${gameIds.length} unique game IDs\n`);
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

      const gameData = {
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

      if (!gameData.title) throw new Error('Missing title');

      return gameData;
    } catch (error) {
      console.error(`❌ Game ${gameId}:`, error.message);
      return { error: error.message };
    }
  }

  async scrapePlatform(platformId) {
    const { gameIds, platformName } = await this.scrapeGameIds(platformId);
    if (gameIds.length === 0) return null;

    const existingGames = this.readExistingGames(platformName);
    
    console.log(`⚡ Scraping details for ${gameIds.length} unique games...`);
    
    const batches = [];
    for (let i = 0; i < gameIds.length; i += CONFIG.concurrency) {
      batches.push(gameIds.slice(i, i + CONFIG.concurrency));
    }

    const newGames = [];
    for (let i = 0; i < batches.length; i++) {
      const batchResults = await Promise.all(
        batches[i].map(gameId => 
          this.scrapeGameDetails(gameId)
            .then(result => {
              if (result.error) {
                this.stats.errors++;
                return null;
              }
              
              if (existingGames.has(result.title.toLowerCase())) {
                this.stats.skipped++;
                return null;
              }
              
              // Đánh dấu đã xử lý tiêu đề này ngay trong bộ nhớ để tránh trùng lặp cùng đợt scrape
              existingGames.add(result.title.toLowerCase());
              this.stats.success++;
              return result;
            })
            .catch(() => {
              this.stats.errors++;
              return null;
            })
        )
      );

      const validResults = batchResults.filter(game => game !== null);
      newGames.push(...validResults);
      
      const progress = (((i + 1) / batches.length) * 100).toFixed(1);
      console.log(`📊 Batch ${i + 1}/${batches.length} (${progress}%) | Added: ${validResults.length} | Total New: ${newGames.length}`);
      
      if (i < batches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, CONFIG.delayBetweenDetails));
      }
    }

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
      console.log(`📝 Appended ${newGames.length} unique games to: ${outputFile}`);
    } else {
      fs.writeFileSync(outputFile, csvHeader + '\n' + rows + '\n');
      console.log(`💾 Created new file with ${newGames.length} games: ${outputFile}`);
    }
  }

  async run() {
    console.log(`🎮 Starting Smart Scraper for ${PLATFORM_IDS.length} platforms...\n`);

    for (const platformId of PLATFORM_IDS) {
      console.log(`\n🔸 Processing Platform ID: ${platformId}`);
      const platformData = await this.scrapePlatform(platformId);
      
      if (platformData && platformData.games.length > 0) {
        this.savePlatformData(platformData.platformName, platformData.games);
      } else if (platformData) {
        console.log(`✅ All games up to date for ${platformData.platformName}`);
      }
    }

    console.log(`\n📈 Final Stats:`);
    console.log(`✅ New Added: ${this.stats.success}`);
    console.log(`⏭️ Skipped: ${this.stats.skipped}`);
    console.log(`❌ Errors: ${this.stats.errors}`);
  }
}

async function main() {
  await new GameScraper().run();
}

process.on('SIGINT', () => {
  console.log('\n🛑 Stopped by user');
  process.exit(0);
});

main().catch(console.error);
