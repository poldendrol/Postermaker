// Collects upcoming screenings from small Ghent cinemas into screenings.json.
// Runs daily in GitHub Actions (.github/workflows/cinemas.yml). Each source is parsed from the cinema's own public page;
// if one source breaks, the others still come through and the old entries for the broken one are kept.
import { readFile, writeFile } from "node:fs/promises";

const UA = "Mozilla/5.0 (compatible; MarqueeCinemaBot/1.0; +https://poldendrol.github.io/Postermaker/)";
const get = async u => { const r = await fetch(u, { headers: { "user-agent": UA, "accept-language": "nl-BE,nl;q=0.9" } }); if (!r.ok) throw new Error(`${u} -> ${r.status}`); return r.text(); };
const decode = s => s.replace(/&quot;/g, '"').replace(/&#0?39;|&#x27;|&rsquo;|&#8217;/g, "’").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#8211;|&ndash;/g, "–").replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, "&");
const strip = s => decode(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const pad = n => String(n).padStart(2, "0");
const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Brussels" }));
const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const inferYear = month => month < now.getMonth() + 1 - 2 ? now.getFullYear() + 1 : now.getFullYear();
const MONTHS = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];

async function kask() {
  const h = await get("https://schoolofartsgent.be/en/artistic-activities/kask-cinema");
  const out = [];
  for (const m of h.matchAll(/<a href="(https:\/\/schoolofartsgent\.be\/en\/agenda\/[^"]+)"[^>]*class="item agenda[^"]*"[^>]*>([\s\S]*?)<\/a>/g)) {
    const date = m[2].match(/class="date">\s*(\d\d)\.(\d\d)\.(\d\d),\s*(?:(\d\d):(\d\d))?/);
    const title = m[2].match(/class="title">([\s\S]*?)<\/span>/);
    if (!date || !title) continue;
    const t = strip(title[1]).replace(/,?\s*KASKcinema\s*$/i, "").trim();
    out.push({ c: "KASKcinema", t, d: `20${date[3]}-${date[2]}-${date[1]}`, h: date[4] ? `${date[4]}:${date[5]}` : "", u: m[1] });
  }
  return out;
}

async function sphinx() {
  const h = await get("https://www.sphinx-cinema.be/programma");
  const out = []; let d = "", time = "";
  const re = /<h2>\s*[a-z]+\s+(\d{1,2})\s+([a-z]+)\s*<\/h2>|component-screenings__time">\s*(\d\d:\d\d)\s*<|component-screenings__title">\s*<a href="([^"]+)">([\s\S]*?)<\/a>/g;
  for (const m of h.matchAll(re)) {
    if (m[1]) { const mo = MONTHS.indexOf(m[2]) + 1; d = mo ? `${inferYear(mo)}-${pad(mo)}-${pad(+m[1])}` : ""; }
    else if (m[3]) time = m[3];
    else if (m[4] && d) out.push({ c: "Sphinx", t: strip(m[5]), d, h: time, u: new URL(m[4], "https://www.sphinx-cinema.be").href });
  }
  return out;
}

async function skoop() {
  const h = await get("https://www.studioskoop.be/agenda-studio-skoop/");
  const out = [];
  for (const m of h.matchAll(/data-event="([^"]+)"([^>]*)>/g)) {
    let e; try { e = JSON.parse(decode(m[1])); } catch { continue; }
    if (!e.film_name || !e.show_date) continue;
    const [dd, mm, yy] = e.show_date.split("-"), href = m[2].match(/data-href="([^"]+)"/);
    out.push({ c: "Studio Skoop", t: String(e.film_name).trim(), d: `${yy}-${mm}-${dd}`, h: e.show_time || "", u: href ? href[1] : "https://www.studioskoop.be/agenda-studio-skoop/" });
  }
  return out;
}

const SOURCES = { "KASKcinema": kask, "Sphinx": sphinx, "Studio Skoop": skoop };
let old = { screenings: [] }; try { old = JSON.parse(await readFile("screenings.json", "utf8")); } catch {}
const all = [], status = {};
for (const [name, fn] of Object.entries(SOURCES)) {
  try {
    const list = (await fn()).filter(x => x.t && /^\d{4}-\d\d-\d\d$/.test(x.d));
    if (!list.length) throw new Error("no screenings found (page layout changed?)");
    all.push(...list); status[name] = list.length;
  } catch (e) {
    console.error(`!! ${name}: ${e.message}`);
    const kept = (old.screenings || []).filter(x => x.c === name); all.push(...kept); status[name] = `failed, kept ${kept.length}`;
  }
}
const seen = new Set();
const screenings = all.filter(x => { const k = `${x.c}|${x.d}|${x.h}|${x.t}`; if (x.d < todayStr || seen.has(k)) return false; seen.add(k); return true; })
  .sort((a, b) => (a.d + a.h).localeCompare(b.d + b.h) || a.c.localeCompare(b.c));
console.log(status, screenings.length, "upcoming screenings");
for (const c of Object.keys(SOURCES)) console.log(c, JSON.stringify(screenings.filter(x => x.c === c).slice(0, 3)));
await writeFile("screenings.json", JSON.stringify({ updated: new Date().toISOString(), status, screenings }) + "\n");
