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

// UiT in Vlaanderen (Flanders' public events listing): every film event in Ghent, including one-off screenings at
// cultural centres, libraries, bars and festivals. Venues we already read directly are skipped to avoid duplicates.
function unNuxt(html) {
  const m = html.match(/<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/); if (!m) return null;
  const raw = JSON.parse(m[1]), memo = new Map();
  const WRAP = new Set(["Reactive", "ShallowReactive", "Ref", "ShallowRef", "EmptyRef", "EmptyShallowRef", "NuxtError"]);
  const rev = i => {
    if (typeof i !== "number" || i < 0) return undefined;
    if (memo.has(i)) return memo.get(i);
    const v = raw[i];
    if (Array.isArray(v)) {
      if (typeof v[0] === "string" && WRAP.has(v[0])) { const r = rev(v[1]); memo.set(i, r); return r; }
      if (v[0] === "Set" || v[0] === "Map") return null;
      if (v[0] === "Date") return v[1];
      const out = []; memo.set(i, out); v.forEach(x => out.push(rev(x))); return out;
    }
    if (v && typeof v === "object") { const o = {}; memo.set(i, o); for (const k in v) o[k] = rev(v[k]); return o; }
    return v;
  };
  return rev(0);
}
const local = isoStr => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(isoStr)).map(x => [x.type, x.value]));
  return { d: `${p.year}-${p.month}-${p.day}`, h: `${p.hour}:${p.minute}` };
};
const slug = t => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "film";
async function uit() {
  const out = [];
  for (let page = 1; page <= 15; page++) {
    const root = unNuxt(await get(`https://www.uitinvlaanderen.be/agenda/film/gent?page=${page}`));
    const events = root?.pinia?.eventSearch?.result?.events?.data || [];
    if (!events.length) break;
    for (const e of events) {
      const venue = e.location?.name || "";
      if (!venue || /sphinx|skoop|kask/i.test(venue)) continue;
      const subs = e.subEvent?.length ? e.subEvent : e.calendar?.startDate ? [{ startDate: e.calendar.startDate }] : [];
      if (subs.length > 40) continue; // permanent installations, not screenings
      const u = `https://www.uitinvlaanderen.be/agenda/e/${slug(e.name || "")}/${e.id}`;
      for (const se of subs) { if (!se.startDate) continue; const { d, h } = local(se.startDate); out.push({ c: venue.replace(/\s+/g, " ").trim(), t: String(e.name || "").trim(), d, h: h === "00:00" ? "" : h, u, o: 1 }); }
    }
    if (events.length < 10) break;
  }
  return out;
}

const SOURCES = { "KASKcinema": kask, "Sphinx": sphinx, "Studio Skoop": skoop, "Elsewhere in Ghent": uit };
let old = { screenings: [] }; try { old = JSON.parse(await readFile("screenings.json", "utf8")); } catch {}
const all = [], status = {};
for (const [name, fn] of Object.entries(SOURCES)) {
  try {
    const list = (await fn()).filter(x => x.t && /^\d{4}-\d\d-\d\d$/.test(x.d));
    if (!list.length) throw new Error("no screenings found (page layout changed?)");
    all.push(...list); status[name] = list.length;
  } catch (e) {
    console.error(`!! ${name}: ${e.message}`);
    const kept = (old.screenings || []).filter(x => name === "Elsewhere in Ghent" ? x.o : x.c === name); all.push(...kept); status[name] = `failed, kept ${kept.length}`;
  }
}
const seen = new Set();
const screenings = all.filter(x => { const k = `${x.c}|${x.d}|${x.h}|${x.t}`; if (x.d < todayStr || seen.has(k)) return false; seen.add(k); return true; })
  .sort((a, b) => (a.d + a.h).localeCompare(b.d + b.h) || a.c.localeCompare(b.c));
console.log(status, screenings.length, "upcoming screenings");
for (const c of Object.keys(SOURCES)) console.log(c, JSON.stringify(screenings.filter(x => x.c === c).slice(0, 3)));
const others = screenings.filter(x => x.o); console.log("Elsewhere venues:", [...new Set(others.map(x => x.c))].join(" | "));
console.log("Elsewhere sample:", JSON.stringify(others.slice(0, 6)));
await writeFile("screenings.json", JSON.stringify({ updated: new Date().toISOString(), status, screenings }) + "\n");
