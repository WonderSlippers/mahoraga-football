import fs from "node:fs";
const dir = ".runtime-v2/usability";
fs.mkdirSync(dir, { recursive: true });
const urls = [
  "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.friendly/scoreboard?dates=20261001&limit=100",
  "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.friendly/summary?event=401919420",
  "https://sports.core.api.espn.com/v2/sports/soccer/leagues/fifa.friendly/events/401919420/competitions/401919420/odds?limit=100",
  "https://www.eloratings.net/World.tsv",
  "https://www.eloratings.net/Maldives.tsv",
  "https://www.eloratings.net/Lebanon.tsv",
  "https://www.pokerstars.es/sports/futbol/1/amistosos-internacionales/12205166/republic-of-maldives-libano/36134706/",
];
const results = await Promise.all(
  urls.map(async (url, i) => {
    const at = new Date().toISOString();
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(20000),
        headers: { Accept: "application/json,text/plain,text/html" },
      });
      const raw = await res.text();
      fs.writeFileSync(`${dir}/source-probe-${i}.txt`, raw);
      let json;
      try {
        json = JSON.parse(raw);
      } catch {}
      return {
        url,
        at,
        status: res.status,
        bytes: Buffer.byteLength(raw),
        file: `${dir}/source-probe-${i}.txt`,
        keys: json ? Object.keys(json) : null,
        events: json?.events?.map((e) => ({
          id: e.id,
          name: e.name,
          date: e.date,
          odds: e.competitions?.[0]?.odds,
        })),
        odds: json?.odds ?? json?.pickcenter ?? json?.items,
        preview: raw.slice(0, 120),
      };
    } catch (e) {
      return { url, at, error: String(e) };
    }
  }),
);
fs.writeFileSync(`${dir}/source-probes.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
