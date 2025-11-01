async function getGameDetail(id) {
  const url = `${BASE_URL}/game.php?id=${id}`;
  console.log(`→ Fetching game: ${url}`);

  const res = await fetch(url);
  const html = await res.text();
  const $ = cheerio.load(html);

  const cardHeaders = $("div.card.border-primary h1");
  if (cardHeaders.length === 0) return null;

  // Khối thông tin chính
  const title = $("div.card.border-primary h1").first().text().trim();
  const aka = $("div.card.border-primary h6.text-muted").first().text().replace("Also know as:", "").trim();
  const overview = $("p.game-overview").text().replace(/\s+/g, " ").trim();
  const esrb = $("p:contains('ESRB')").text().replace("ESRB Rating:", "").trim();
  const genre = $("p:contains('Genre')").text().replace("Genre(s):", "").trim();

  // Khối thông tin bên dưới (platform, region, country, developer, etc.)
  const infoCard = $("div.card.border-primary").eq(1);
  const platform = infoCard.find("p:contains('Platform') a").text().trim();
  const region = infoCard.find("p:contains('Region')").text().replace("Region:", "").trim();
  const country = infoCard.find("p:contains('Country')").text().replace("Country:", "").trim();
  const developer = infoCard.find("p:contains('Developer') a").map((i, el) => $(el).text().trim()).get().join(", ");
  const publisher = infoCard.find("p:contains('Publisher') a").map((i, el) => $(el).text().trim()).get().join(", ");
  const release = infoCard.find("p:contains('ReleaseDate')").text().replace("ReleaseDate:", "").trim();
  const players = infoCard.find("p:contains('Players')").text().replace("Players:", "").trim();
  const coop = infoCard.find("p:contains('Co-op')").text().replace("Co-op:", "").trim();

  // Ảnh
  const image = $("a.fancybox-thumb").attr("href") || $(".card-img-top").attr("src") || "";

  return {
    id,
    title,
    aka,
    overview,
    esrb,
    genre,
    platform,
    region,
    country,
    developer,
    publisher,
    release,
    players,
    coop,
    image: image.startsWith("http") ? image : `${BASE_URL}${image}`
  };
}
