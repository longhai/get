async function getGameDetail(id) {
  const url = `${BASE_URL}/game.php?id=${id}`;
  const res = await fetch(url);
  const html = await res.text();
  const $ = cheerio.load(html);

  // card đầu tiên (thông tin mô tả)
  const card1 = $(".card.border-primary").first();
  const title = card1.find("h1").text().trim();
  const aka = card1.find("h6.text-muted").text().replace("Also know as:", "").trim();
  const overview = card1.find(".game-overview").text().replace(/\s+/g, " ").trim();
  const esrb = card1.find("p:contains('ESRB')").text().replace("ESRB Rating:", "").trim();
  const genre = card1.find("p:contains('Genre')").text().replace("Genre(s):", "").trim();

  // card thứ hai (thông tin chi tiết)
  const card2 = $(".card.border-primary").eq(1);
  const img = card2.find("img.card-img-top").attr("src") || "";
  const platform = card2.find("p:contains('Platform') a").text().trim();
  const region = card2.find("p:contains('Region')").text().replace("Region:", "").trim();
  const country = card2.find("p:contains('Country')").text().replace("Country:", "").trim();
  const developer = card2.find("p:contains('Developer') a").map((_, e) => $(e).text().trim()).get().join(", ");
  const publisher = card2.find("p:contains('Publisher') a").map((_, e) => $(e).text().trim()).get().join(", ");
  const releaseDate = card2.find("p:contains('ReleaseDate')").text().replace("ReleaseDate:", "").trim();
  const players = card2.find("p:contains('Players')").text().replace("Players:", "").trim();
  const coop = card2.find("p:contains('Co-op')").text().replace("Co-op:", "").trim();

  return {
    id,
    title,
    aka,
    overview,
    esrb,
    genre,
    img,
    platform,
    region,
    country,
    developer,
    publisher,
    releaseDate,
    players,
    coop,
  };
}
