// Temporary probe.
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const get = async u => { const r = await fetch(u, { headers: { "user-agent": UA, "accept-language": "nl-BE,nl;q=0.9,en;q=0.8" } }); return [r.status, r.url, await r.text()]; };
const base = "https://cinema.be/nl/bioscopen/kinepolis-gent-e9d3bd1c-e";
for (const u of [base, base + "?date=2026-11-25", base + "?datum=2026-11-25", base + "?day=1"]) {
  const [st, fin, h] = await get(u);
  const titles = [...h.matchAll(/<img alt="([^"]+)" loading/g)].map(m => m[1]);
  const times = [...h.matchAll(/tabular-nums leading-none">(\d\d:\d\d)</g)].map(m => m[1]);
  const ld = [...h.matchAll(/<script[^>]*ld\+json[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).find(x => /MovieTheater/.test(x));
  const evs = ld ? JSON.parse(ld).event || [] : [];
  console.log("=====", u, st, h.length, "imgs", titles.length, "times", times.length, "ld events", evs.length, evs.map(e => e.startDate.slice(5, 16) + " " + e.name.replace(" - Kinepolis Gent", "")).join(" | ").slice(0, 1500));
  console.log("titles:", [...new Set(titles)].slice(0, 40).join(" | "));
  console.log("date links:", [...new Set([...h.matchAll(/href="([^"]*(?:date|datum|dag|day)=[^"]*)"/gi)].map(m => m[1]))].slice(0, 15).join(" "));
  const fl = [...h.matchAll(/self\.__next_f\.push\(\[1,"([\s\S]*?)"\]\)/g)].map(m => m[1]).join("");
  const i = fl.indexOf("ShowtimesList"); const j = fl.indexOf("$L24"); console.log("SHOWTIMESLIST props:", fl.slice(j, j + 1500));
  const apis = [...new Set([...fl.matchAll(/api\.cinema\.be\/[a-z0-9\/_?=&.-]*/gi)].map(m => m[0]))].filter(x => !/uploads/.test(x)); console.log("API refs:", apis.join(" "));
}
for (const u of ["https://api.cinema.be/", "https://api.cinema.be/api/cinemas/kinepolis-gent-e9d3bd1c-e/showtimes", "https://api.cinema.be/showtimes?cinema=kinepolis-gent-e9d3bd1c-e"]) { try { const [st, , h] = await get(u); console.log("API", u, st, h.slice(0, 300)); } catch (e) { console.log("API ERR", u, e.message); } }
