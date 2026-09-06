import fs from "fs";
import * as cheerio from "cheerio";

const BASE_URL = "https://thegamesdb.net/list_games.php";
const OUTPUT_DIR = "data";

const PLATFORM_IDS = (process.env.PLATFORM_IDS || "")
  .split(",")
  .map(Number)
  .filter(Boolean);

const CONFIG = {
  delayBetweenPages: 500,
  delayBetweenDetails: 100,
  maxRetries: 3,
  timeout: 30000,
  concurrency: 12
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

function parseCsvLine(line) {
  const result = [];
  let current = "";
  let quotes = false;

  for (let i = 0; i < line.length; i++) {
    const c = line[i];

    if (c === '"' && line[i + 1] === '"') {
      current += '"';
      i++;
    } else if (c === '"') {
      quotes = !quotes;
    } else if (c === "," && !quotes) {
      result.push(current);
      current = "";
    } else {
      current += c;
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

  async fetchWithRetry(url) {
    for (let attempt = 1; attempt <= CONFIG.maxRetries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        CONFIG.timeout
      );

      try {
        const res = await fetch(url, {
          signal: controller.signal,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
          }
        });

        clearTimeout(timer);

        if (!res.ok)
          throw new Error(`HTTP ${res.status}`);

        return await res.text();

      } catch (err) {
        clearTimeout(timer);

        if (attempt === CONFIG.maxRetries)
          throw err;

        console.log(
          `⚠️ Retry ${attempt}/${CONFIG.maxRetries}: ${url}`
        );

        await sleep(attempt * 1500);
      }
    }
  }

  readExistingGames(platformName) {
    const clean = platformName
      .replace(/[<>:"/\\|?*]/g, "")
      .trim();

    const file = `${OUTPUT_DIR}/${clean}.csv`;
    const titles = new Set();

    if (!fs.existsSync(file))
      return titles;

    try {
      const lines = fs
        .readFileSync(file, "utf8")
        .split(/\r?\n/)
        .slice(1);

      for (const line of lines) {
        if (!line.trim()) continue;

        const title = parseCsvLine(line)[0]?.trim();

        if (title)
          titles.add(title.toLowerCase());
      }

      console.log(
        `📚 Existing: ${titles.size} titles`
      );

    } catch {
      console.log("⚠️ Cannot read existing CSV");
    }

    return titles;
  }

  async scrapeGameIds(platformId) {
    console.log(`\n📥 Platform ${platformId}`);

    const ids = new Set();
    let page = 1;
    let platformName = "";

    while (true) {
      const url =
        `${BASE_URL}?platform_id=${platformId}&page=${page}`;

      console.log(`🔹 Page ${page}`);

      try {
        const html = await this.fetchWithRetry(url);
        const $ = cheerio.load(html);

        if (!platformName) {
          platformName =
            $(".card-header legend").first().text().trim();

          if (!platformName) {
            platformName =
              $("h1").first().text().trim();
          }

          platformName =
            platformName.replace(/\s+/g, " ").trim();
        }

        let found = 0;

        // Tìm trực tiếp game.php?id= thay vì phụ thuộc card
        $("a[href*='game.php?id=']").each((_, el) => {
          const href = $(el).attr("href");
          const match = href?.match(
            /[?&]id=(\d+)/
          );

          if (match) {
            ids.add(match[1]);
            found++;
          }
        });

        console.log(
          `   Found ${found} links | Unique: ${ids.size}`
        );

        if (!found)
          break;

        const next =
          $("a.page-link")
            .filter((_, el) =>
              $(el).text().trim()
                .toLowerCase()
                .includes("next")
            )
            .length > 0;

        if (!next)
          break;

        page++;

        await sleep(CONFIG.delayBetweenPages);

      } catch (err) {
        console.error(
          `❌ Page ${page}: ${err.message}`
        );
        break;
      }
    }

    console.log(
      `📋 ${platformName}: ${ids.size} unique IDs`
    );

    return {
      gameIds: [...ids],
      platformName
    };
  }

  async scrapeGameDetails(id) {
    try {
      const html = await this.fetchWithRetry(
        `https://thegamesdb.net/game.php?id=${id}`
      );

      const $ = cheerio.load(html);

      const left =
        $(".col-12.col-md-3.col-lg-2 .card.border-primary");

      const main =
        $(".col-12.col-md-9.col-lg-8 .card.border-primary")
          .first();

      const text = (el, label) =>
        el.text().replace(label, "").trim();

      const game = {
        title: $("h1").first().text().trim(),

        alternate_titles:
          text($("h6.text-muted").first(), "Also know as:"),

        region:
          text(left.find("p:contains('Region:')"), "Region:"),

        country:
          text(left.find("p:contains('Country:')"), "Country:"),

        publisher:
          text(
            left.find("p:contains('Publishers(s):')"),
            "Publishers(s):"
          ),

        developer:
          text(
            left.find("p:contains('Developer(s):')"),
            "Developer(s):"
          ),

        release_date:
          text(
            left.find("p:contains('ReleaseDate:')"),
            "ReleaseDate:"
          ),

        players:
          text(
            left.find("p:contains('Players:')"),
            "Players:"
          ),

        coop:
          text(
            left.find("p:contains('Co-op:')"),
            "Co-op:"
          ),

        genre:
          text(
            main.find("p:contains('Genre(s):')"),
            "Genre(s):"
          ),

        esrb_rating:
          text(
            main.find("p:contains('ESRB Rating:')"),
            "ESRB Rating:"
          ),

        description:
          main.find(".game-overview").text().trim()
      };

      if (!game.title)
        throw new Error("Missing title");

      return game;

    } catch (err) {
      console.error(
        `❌ Game ${id}: ${err.message}`
      );

      return null;
    }
  }

  async scrapePlatform(platformId) {
    const { gameIds, platformName } =
      await this.scrapeGameIds(platformId);

    if (!gameIds.length)
      return null;

    const existing =
      this.readExistingGames(platformName);

    const newGames = [];

    for (
      let i = 0;
      i < gameIds.length;
      i += CONFIG.concurrency
    ) {
      const batch =
        gameIds.slice(i, i + CONFIG.concurrency);

      const results =
        await Promise.all(
          batch.map(async id => {
            const game =
              await this.scrapeGameDetails(id);

            if (!game) {
              this.stats.errors++;
              return null;
            }

            const key =
              game.title.toLowerCase();

            if (existing.has(key)) {
              this.stats.skipped++;
              return null;
            }

            existing.add(key);
            this.stats.success++;

            return game;
          })
        );

      newGames.push(
        ...results.filter(Boolean)
      );

      console.log(
        `📊 ${Math.min(
          i + CONFIG.concurrency,
          gameIds.length
        )}/${gameIds.length} | ` +
        `New: ${newGames.length}`
      );

      if (
        i + CONFIG.concurrency <
        gameIds.length
      ) {
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
    if (!games.length)
      return;

    fs.mkdirSync(
      OUTPUT_DIR,
      { recursive: true }
    );

    const clean =
      platformName
        .replace(/[<>:"/\\|?*]/g, "")
        .trim();

    const file =
      `${OUTPUT_DIR}/${clean}.csv`;

    const header =
      "title,alternate_titles,region,country,publisher,developer,release_date,players,coop,genre,esrb_rating,description";

    const row = game => [
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
      .map(v =>
        `"${String(v || "").replace(/"/g, '""')}"`
      )
      .join(",");

    const data =
      games.map(row).join("\n") + "\n";

    if (fs.existsSync(file)) {
      const old =
        fs.readFileSync(file, "utf8");

      fs.appendFileSync(
        file,
        (old.endsWith("\n") ? "" : "\n") +
        data
      );
    } else {
      fs.writeFileSync(
        file,
        header + "\n" + data
      );
    }

    console.log(
      `💾 Saved ${games.length}: ${file}`
    );
  }

  async run() {
    if (!PLATFORM_IDS.length) {
      throw new Error(
        "PLATFORM_IDS is empty"
      );
    }

    console.log(
      `🎮 Platforms: ${PLATFORM_IDS.join(", ")}`
    );

    for (const id of PLATFORM_IDS) {
      const result =
        await this.scrapePlatform(id);

      if (result) {
        this.savePlatformData(
          result.platformName,
          result.games
        );
      }
    }

    console.log("\n📈 FINAL");
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
  .catch(err => {
    console.error("💥", err);
    process.exit(1);
  });
