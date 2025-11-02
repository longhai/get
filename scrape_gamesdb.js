import fetch from "node-fetch";
import * as cheerio from "cheerio";

const URL = "https://thegamesdb.net/game.php?id=29289";

async function scrapeGame(url) {
  const res = await fetch(url);
  const html = await res.text();
  const $ = cheerio.load(html);

  const title = $("h1").first().text().trim();
  const overview = $("div.card-body p").first().text().trim();
  const platform = $("div.card-body p:contains('Platform:')").text().replace("Platform:", "").trim();
  const releaseDate = $("div.card-body p:contains('Release Date:')").text().replace("Release Date:", "").trim();
  const region = $("div.card-body p:contains('Region:')").text().replace("Region:", "").trim();
  const developers = $("div.card-body p:contains('Developer:')").text().replace("Developer:", "").trim();
  const publishers = $("div.card-body p:contains('Publisher:')").text().replace("Publisher:", "").trim();
  const imageUrl = $("div.card-body img").attr("src") || "";

  return { title, overview, platform, releaseDate, region, developers, publishers, imageUrl };
}

(async () => {
  try {
    const game = await scrapeGame(URL);
    console.log(game);
  } catch (err) {
    console.error("Error scraping game:", err);
  }
})();
