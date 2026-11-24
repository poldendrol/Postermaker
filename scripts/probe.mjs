// Temporary probe.
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const get = async u => { const r = await fetch(u, { headers: { "user-agent": UA, "accept-language": "nl-BE,nl;q=0.9" } }); return [r.status, r.url, await r.text()]; };
const [s1, f1, ov] = await get("https://cinebel.dhnet.be/cinemas/11/Flandre%20orientale");
console.log("OV", s1, f1, ov.length, "links:", [...new Set([...ov.matchAll(/href="([^"]+)"/g)].map(m => m[1]))].filter(x => /cinema|theater/i.test(x)).join(" "));
for (const u of ["https://kinepolis.be/nl/", "https://kinepolis.be/api/", "https://www.kinepolis.be/nl"]) { try { const [s, f, h] = await get(u); console.log("KP", u, s, f, h.slice(0, 300).replace(/\s+/g, " ")); } catch (e) { console.log("KP ERR", u, e.message); } }
const [st, fin, h] = await get("https://www.uitinvlaanderen.be/agenda/film/gent");
const m = h.match(/<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
console.log("NUXT_DATA len", m && m[1].length);
const raw = JSON.parse(m[1]);
const memo = new Map();
const rev = i => {
  if (typeof i !== "number") return i;
  if (i < 0) return undefined;
  if (memo.has(i)) return memo.get(i);
  const v = raw[i];
  if (Array.isArray(v)) {
    if (typeof v[0] === "string" && ["Reactive", "ShallowReactive", "Ref", "ShallowRef", "EmptyRef", "EmptyShallowRef", "NuxtError"].includes(v[0])) { const r = rev(v[1]); memo.set(i, r); return r; }
    if (v[0] === "Set" || v[0] === "Map") { memo.set(i, null); return null; }
    if (v[0] === "Date") return v[1];
    const out = []; memo.set(i, out); v.forEach(x => out.push(rev(x))); return out;
  }
  if (v && typeof v === "object") { const o = {}; memo.set(i, o); for (const k in v) o[k] = rev(v[k]); return o; }
  return v;
};
const root = rev(0);
const find = (o, depth = 0, path = "") => { if (!o || typeof o !== "object" || depth > 8) return; if (Array.isArray(o)) { if (o.length > 5 && o[0] && typeof o[0] === "object" && ("name" in o[0] || "startDate" in o[0] || "calendarSummary" in o[0])) console.log("LIST at", path, o.length, JSON.stringify(o[0]).slice(0, 3500)); o.slice(0, 3).forEach((x, i) => find(x, depth + 1, path + "[" + i + "]")); return; } for (const k in o) find(o[k], depth + 1, path + "." + k); };
find(root);
console.log("ROOT keys", JSON.stringify(Object.keys(root || {})), JSON.stringify(Object.keys(root?.data || {})).slice(0, 500));
