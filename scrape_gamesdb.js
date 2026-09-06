import fs from "fs";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const BASE_URL = "https://thegamesdb.net/list_games.php";
const OUTPUT_DIR = "data";

const PLATFORM_IDS = (process.env.PLATFORM_IDS || "")
  .split(",")
  .map(x => x.trim())
  .filter(Boolean)
  .map(Number);

const CONFIG = {
  delayBetweenPages: 500,
  delayBetweenDetails: 100,
  maxRetries: 3,
  timeout: 30000,
  concurrency: 12
};

if (!PLATFORM_IDS.length) {
  throw new Error("PLATFORM_IDS is empty");
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseCsvLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"' && line[i + 1] === '"') {
      current += '"';
      i++;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  result.push(current);
  return result;
}

class GameScraper {
  constructor() {
    this.stats = {
      total: 0,
      success: 0,
      errors: 0,
      skipped: 0
    };
  }

  async fetchWithRetry(url, retries = CONFIG.maxRetries) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      let controller;
      let timeoutId;

      try {
        controller = new AbortController();

        timeoutId = setTimeout(
          () => controller.abort(),
          CONFIG.timeout
        );

        const res = await fetch(url, {
          signal: controller.signal,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
          }
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        return await res.text();
      } catch (error) {
        if (attempt === retries) throw error;

        console.log(
          `⚠️ Retry ${attempt}/${retries}: ${url}`
        );

        await sleep(1000 * attempt);
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
    }
  }

  cleanFileName(name) {
    return name
      .replace(/[<>:"/\\|?*]/g, "")
      .trim();
  }

  readExistingGames(platformName) {
    const cleanName = this.cleanFileName(platformName);

    if (!cleanName) return new Set();

    const filePath = `${OUTPUT_DIR}/${cleanName}.csv`;

    if (!fs.existsSync(filePath)) {
      return new Set();
    }

    try {
      const content = fs.readFileSync(filePath, "utf8");
      const lines = content.split(/\r?\n/).slice(1);

      const existingTitles = new Set();

      for (const line of lines) {
        if (!line.trim()) continue;

        const columns = parseCsvLine(line);
        const title = columns[0]?.trim();

        if (title) {
          existingTitles.add(title.toLowerCase());
        }
      }

      console.log(
        `📚 Existing: ${existingTitles.size} games`
      );

      return existingTitles;
    } catch {
      console.log("⚠️ Cannot read existing CSV");
      return new Set();
    }
  }

  async scrapeGameIds(platformId) {
    console.log(`\n📥 Platform ${platformId}`);

    const gameIdsSet = new Set();
    let platformName = "";
    let page = 1;

    while (true) {
      const url =
        `${BASE_URL}?platform_id=${platformId}&page=${page}`;

      console.log(`🔹 Page ${page}`);

      try {
        const html = await this.fetchWithRetry(url);
        const $ = cheerio.load(html);

        if (!platformName) {
          platformName =
            $(".card-header legend").first().text().trim() ||
            $("h1").first().text().trim() ||
            `Platform_${platformId}`;

          platformName =
            platformName.replace(/\s+/g, " ");
        }

        // Tìm trực tiếp link game thay vì phụ thuộc card
        $("a[href*='game.php?id=']").each((_, el) => {
          const href = $(el).attr("href");
          const match = href?.match(/[?&]id=(\d+)/);

          if (match) {
            gameIdsSet.add(match[1]);
          }
        });

        console.log(
          `   Found: ${gameIdsSet.size} IDs`
        );

        const next =
          $("a.page-link")
            .filter((_, el) =>
              $(el).text().trim().toLowerCase() === "next"
            )
            .length > 0;

        if (!next) break;

        page++;
        await sleep(CONFIG.delayBetweenPages);

      } catch (error) {
        console.error(
          `❌ Page ${page}: ${error.message}`
        );
        break;
      }
    }

    const gameIds = [...gameIdsSet];

    console.log(
      `📋 ${platformName}: ${gameIds.length} unique games`
    );

    return {
      gameIds,
      platformName
    };
  }

  async scrapeGameDetails(gameId) {
    try {
      const html = await this.fetchWithRetry(
        `https://thegamesdb.net/game.php?id=${gameId}`
      );

      const $ = cheerio.load(html);

      const leftCard =
        $(".col-12.col-md-3.col-lg-2 .card.border-primary")
          .first();

      const mainCard =
        $(".col-12.col-md-9.col-lg-8 .card.border-primary")
          .first();

      const getText = (selector, remove = "") =>
        $(selector)
          .text()
          .replace(remove, "")
          .trim();

      const gameData = {
        title: $("h1").first().text().trim(),

        alternate_titles:
          getText("h6.text-muted", "Also know as:"),

        region:
          getText(
            leftCard.find("p:contains('Region:')"),
            "Region:"
          ),

        country:
          getText(
            leftCard.find("p:contains('Country:')"),
            "Country:"
          ),

        publisher:
          getText(
            leftCard.find("p:contains('Publishers(s):')"),
            "Publishers(s):"
          ),

        developer:
          getText(
            leftCard.find("p:contains('Developer(s):')"),
            "Developer(s):"
          ),

        release_date:
          getText(
            leftCard.find("p:contains('ReleaseDate:')"),
            "ReleaseDate:"
          ),

        players:
          getText(
            leftCard.find("p:contains('Players:')"),
            "Players:"
          ),

        coop:
          getText(
            leftCard.find("p:contains('Co-op:')"),
            "Co-op:"
          ),

        genre:
          getText(
            mainCard.find("p:contains('Genre(s):')"),
            "Genre(s):"
          ),

        esrb_rating:
          getText(
            mainCard.find("p:contains('ESRB Rating:')"),
            "ESRB Rating:"
          ),

        description:
          mainCard.find(".game-overview").text().trim()
      };

      if (!gameData.title) {
        throw new Error("Missing title");
      }

      return gameData;

    } catch (error) {
      console.error(
        `❌ Game ${gameId}: ${error.message}`
      );

      return {
        error: error.message
      };
    }
  }

  async scrapePlatform(platformId) {
    const {
      gameIds,
      platformName
    } = await this.scrapeGameIds(platformId);

    if (!gameIds.length) {
      return {
        platformName,
        games: []
      };
    }

    const existingGames =
      this.readExistingGames(platformName);

    const newGames = [];

    console.log(
      `⚡ Details: ${gameIds.length} games`
    );

    for (
      let i = 0;
      i < gameIds.length;
      i += CONFIG.concurrency
    ) {
      const batch =
        gameIds.slice(i, i + CONFIG.concurrency);

      const results = await Promise.all(
        batch.map(async gameId => {
          const result =
            await this.scrapeGameDetails(gameId);

          if (result.error) {
            this.stats.errors++;
            return null;
          }

          const key =
            result.title.toLowerCase();

          if (existingGames.has(key)) {
            this.stats.skipped++;
            return null;
          }

          existingGames.add(key);
          this.stats.success++;

          return result;
        })
      );

      const valid =
        results.filter(Boolean);

      newGames.push(...valid);

      console.log(
        `📊 ${Math.min(
          i + CONFIG.concurrency,
          gameIds.length
        )}/${gameIds.length}` +
        ` | New: ${valid.length}` +
        ` | Total new: ${newGames.length}`
      );

      if (i + CONFIG.concurrency < gameIds.length) {
        await sleep(CONFIG.delayBetweenDetails);
      }
    }

    this.stats.total += gameIds.length;

    return {
      platformName,
      games: newGames
    };
  }

  savePlatformData(platformName, games) {
    if (!games.length) {
      console.log(
        `✅ Up to date: ${platformName}`
      );
      return;
    }

    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, {
        recursive: true
      });
    }

    const cleanName =
      this.cleanFileName(platformName);

    if (!cleanName) {
      console.log(
        `⚠️ Invalid platform name: ${platformName}`
      );
      return;
    }

    const outputFile =
      `${OUTPUT_DIR}/${cleanName}.csv`;

    const header =
      "title,alternate_titles,region,country,publisher,developer,release_date,players,coop,genre,esrb_rating,description";

    const formatRow = game =>
      [
        game.title,
        game.alternate_titles,
        game.region,
        game.country,
        game.publisher,
        game.developer,
        game.release_date,
        game.players,
        game.coop,
        game.genre,
        game.esrb_rating,
        game.description
      ]
        .map(x =>
          `"${String(x || "").replace(/"/g, '""')}"`
        )
        .join(",");

    const rows =
      games.map(formatRow).join("\n");

    if (fs.existsSync(outputFile)) {
      let current =
        fs.readFileSync(outputFile, "utf8");

      if (
        current.length &&
        !current.endsWith("\n")
      ) {
        current += "\n";
      }

      fs.writeFileSync(
        outputFile,
        current + rows + "\n"
      );

      console.log(
        `📝 Added ${games.length}: ${outputFile}`
      );

    } else {
      fs.writeFileSync(
        outputFile,
        header + "\n" + rows + "\n"
      );

      console.log(
        `💾 Created ${outputFile}`
      );
    }
  }

  async run() {
    console.log(
      `🎮 Platforms: ${PLATFORM_IDS.join(", ")}`
    );

    for (const platformId of PLATFORM_IDS) {
      console.log(
        `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
      );

      const data =
        await this.scrapePlatform(platformId);

      if (data) {
        this.savePlatformData(
          data.platformName,
          data.games
        );
      }
    }

    console.log(
      `\n📈 FINAL`
    );

    console.log(
      `✅ New: ${this.stats.success}`
    );

    console.log(
      `⏭️ Skipped: ${this.stats.skipped}`
    );

    console.log(
      `❌ Errors: ${this.stats.errors}`
    );
  }
}

new GameScraper()
  .run()
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
