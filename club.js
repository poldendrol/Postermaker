// Movie club: a group watches one movie a week, votes on the next one and talks about it.
// No accounts and no server of our own. Every action is a small "event" that is saved on this
// device and sent to the club's private ntfy.sh topic, so everyone's copy fills in. ntfy keeps
// messages for about 12 hours, so whoever opens the club re-sends recent events the topic is
// missing. That way the club's state survives as long as any member still has it.
const M = window.Marquee;
const $ = id => document.getElementById(id);
const view = $("clubView"), cineEl = $("cineView"), hist = $("histView"), lead = $("leadView"), mwView = $("mwView");
const APP_URL = location.origin + location.pathname;
const NTFY = window.MARQUEE_NTFY || "https://ntfy.sh";
const TAG = "mqc1:";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const el = html => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const LS = {
  get: (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};
const rand = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => "abcdefghijkmnpqrstuvwxyz23456789"[b % 32]).join("");
const b64 = o => btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = s => JSON.parse(decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/")))));
const now = () => Date.now();
const when = ms => { const m = (now() - ms) / 6e4; return m < 1 ? "just now" : m < 60 ? Math.round(m) + "m ago" : m < 1440 ? Math.round(m / 60) + "h ago" : Math.round(m / 1440) + "d ago"; };
const poster = (p, size = "w154") => p ? `<img src="${M.IMG}${size}${esc(p)}" alt="" loading="lazy">` : `<i class="ph"></i>`;
const avatar = (name, on) => `<span class="avatar${on ? " on" : ""}" title="${esc(name)}">${esc((name || "?")[0].toUpperCase())}</span>`;
const key = m => m ? m.t + ":" + m.i : "";
// "film" { from: key, v: 1|0 } marks a title the movie database only lists as a series as a film (for everyone).
let asFilm = new Set();
const isTv = m => !!m && m.t === "tv" && !asFilm.has(key(m));
const ckey = x => x ? key(x.m) + "@" + (x.sc ? `${x.sc.c}|${x.sc.d}|${x.sc.h}` : "") : "";
const seenKey = t => "t:" + String(t || "").toLowerCase().replace(/\s*\(\d{4}\)\s*$/, "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
let lastState = null;
function seenTag(title, undo) {
  const s = lastState; if (!s || !me) return "";
  const k = seenKey(title), who = [...(s.saw[k] || new Map()).entries()].filter(([, x]) => x.v), mine = who.some(([a]) => a === me.id);
  const others = who.filter(([a]) => a !== me.id).map(([, x]) => x.name), myss = mine ? ssList(s.saw[k].get(me.id).ss) : [];
  return `<button class="seen-tag${mine ? " on" : ""}" data-saw="${esc(k)}" aria-pressed="${mine}" title="${esc(who.length ? "Watched by " + who.map(([a, x]) => a === me.id ? "you" : x.name).join(", ") : "Tap if you've already watched it")}">${mine ? (undo && !myss.length ? "Unwatch" : `✓ ${myss.length ? ssLabel(myss) : "Watched"}`) : "Watched?"}</button>`;
}
// Series seasons on a "saw": ss = { "1": "YYYY-MM-DD", ... } (the day each season was marked watched).
const ssList = ss => Object.keys(ss || {}).map(Number).filter(n => n > 0).sort((a, b) => a - b);
function ssLabel(list) {
  const parts = []; let i = 0;
  while (i < list.length) { let j = i; while (j + 1 < list.length && list[j + 1] === list[j] + 1) j++; parts.push(j > i ? `${list[i]}–${list[j]}` : `${list[i]}`); i = j + 1; }
  return "S" + parts.join(", ");
}
const monthOf = d => d.getFullYear() * 12 + d.getMonth();
// IMDb has no public API for writing lists, so the next best thing: a link to mark it there yourself.
const imdbUrl = m => /^tt\d+$/.test(m.im || "") ? `https://www.imdb.com/title/${m.im}/` : `https://www.imdb.com/find/?q=${encodeURIComponent(m.n + (m.y ? " " + m.y : ""))}&s=tt`;
const imdbLink = m => `<a class="link imdb-l" href="${esc(imdbUrl(m))}" target="_blank" rel="noopener" title="Open on IMDb to mark it there">IMDb ↗</a>`;
const scLabel = sc => { if (!sc || !sc.d) return sc?.c || ""; const [y, m, d] = sc.d.split("-").map(Number); return `${sc.c} · ${new Date(y, m - 1, d, 12).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}${sc.h ? " " + sc.h : ""}`; };
// Stars in half steps: ★★★½☆ (pass bare = true to leave out the empty ones).
const starStr = (n, bare) => { const v = Math.round((+n || 0) * 2) / 2, f = Math.floor(v), h = v - f >= .5; return "★".repeat(f) + (h ? "½" : "") + (bare ? "" : "☆".repeat(5 - f - (h ? 1 : 0))); };
const stars = n => n ? starStr(n) : ""
// Star picker: tap a star for a full score, tap the same star again for half (3 → 2½ → 3).
const halfTap = (cur, n) => cur === n ? n - .5 : n;
const paintStars = (root, v) => root.querySelectorAll(".mstars button").forEach(o => { const n = +o.dataset.s; o.classList.toggle("on", n <= v); o.classList.toggle("half", n - .5 === v); });;

// ---------- local data ----------
let me = LS.get("marqueeClubMe", null);                 // { id, name }
// Clubs you left stay in marqueeClubsGone, so the account sync never brings them back (rejoining with an invite clears it).
const clubs = () => { const gone = new Set(LS.get("marqueeClubsGone", [])); return LS.get("marqueeClubs", []).filter(c => !gone.has(c.id)); }; // [{ id, name, day }]
let activeId = LS.get("marqueeClubActive", null);
const evKey = id => "marqueeClubEv_" + id;
const store = {};                                         // club id -> { event id: event }
const evs = id => (store[id] ||= LS.get(evKey(id), {}));
// Merge what's already stored before writing, so events another tab or the account sync just wrote are never overwritten.
// Removed events stay as tombstones ({...e, gone}) so no device or sync brings them back; a tombstone always wins.
const foldIn = (m, cur) => { for (const k in cur) if (!(k in m) || (cur[k]?.gone && !m[k]?.gone)) m[k] = cur[k]; return m; };
const save = id => { const m = foldIn(store[id] ||= {}, LS.get(evKey(id), {})); LS.set(evKey(id), m); };
const active = () => clubs().find(c => c.id === activeId) || clubs()[0] || null;

function addClub(c) {
  const gone = LS.get("marqueeClubsGone", []); if (gone.includes(c.id)) LS.set("marqueeClubsGone", gone.filter(x => x !== c.id));
  const l = clubs();
  if (!l.some(x => x.id === c.id)) { l.push({ id: c.id, name: c.name || "Movie club", day: c.day ?? 0 }); LS.set("marqueeClubs", l); }
  activeId = c.id; LS.set("marqueeClubActive", activeId);
}
function ensureMe(name) {
  if (!me) me = { id: rand(10), name };
  else me.name = name;
  LS.set("marqueeClubMe", me);
  const fm = LS.get("marqueeMe", null);                  // share the name with Friends
  if (!fm) LS.set("marqueeMe", { name, topic: "mq_" + rand(20) });
}
const defaultName = () => me?.name || LS.get("marqueeMe", null)?.name || "";

// ---------- events ----------
// Event: { i: id, k: kind, a: author id, n: author name, t: time, r: round, ... }
// Kinds: meta {name, day} · join · nom {m} · drop {m} · vote {v: movie key or ""} · pick {m} · unpick
//        say {x} · seen {s}. Nominations and votes in round r choose the movie for round r + 1.
const KINDS = new Set(["meta", "join", "nom", "drop", "vote", "pick", "unpick", "say", "seen", "go", "saw", "wl", "wldrop", "sug", "in", "odate", "ospot", "acc", "sugdrop", "fix", "film", "list", "unlist"]);
// Cinema outings: a "nom" with tr: "m" is a suggested outing (key ok = ckey). "in" { ok, v: 1|0 } joins it, "odate" { ok, sc } sets the date.
// "sug" { m, to: [member ids] or ["*"] for everyone, d: "YYYY-MM-DD" first watch date, wk: 1 = remind weekly until seen }
// "acc" { sg: suggestion id, v: 1|0 } = "I'll watch it in the coming week" (replaces the old weekly reminders; wk is ignored now).
// "say" with sk: seenKey(title) is a comment on that title (talked about per film or series, not per week).
// "wl" { m } adds a film to the shared club watchlist (from IMDb, a saved list or search); "wldrop" { m } takes your add back.
// "saw" { sk: seenKey(title), v: 1|0 } marks that a member has already seen a film (any film, any list).
// Monthly cinema night: the same nom/drop/vote/pick events carry tr: "m", r = year * 12 + month, and sc = the screening
// { c: cinema, d: "YYYY-MM-DD", h: "HH:MM", u: link }. "go" { v: 1|0 } is an RSVP for that month's outing.
function valid(e) {
  return e && typeof e.i === "string" && e.i.length <= 16 && KINDS.has(e.k) && typeof e.a === "string" && typeof e.t === "number" && typeof e.r === "number"
    && (!e.m || (typeof e.m === "object" && (e.m.t === "movie" || e.m.t === "tv") && Number.isFinite(+e.m.i)));
}
function merge(clubId, list) {
  const map = evs(clubId); let fresh = [];
  for (const e of list) {
    if (!valid(e) || map[e.i]) continue;
    if (e.x) e.x = String(e.x).slice(0, 600);
    if (e.n) e.n = String(e.n).slice(0, 40);
    if (e.sk) e.sk = String(e.sk).slice(0, 120);
    if (e.k === "fix" || e.k === "film") e.from = String(e.from || "").slice(0, 40);
    if (e.k === "film") e.v = e.v ? 1 : 0;
    if (e.k === "ospot") { e.ok = String(e.ok || "").slice(0, 200); e.x = String(e.x || "").slice(0, 80); }
    if (e.k === "saw") {
      if (e.rw) e.rw = 1;
      if (e.d && !/^\d{4}-\d\d-\d\d$/.test(e.d)) delete e.d; if (e.imp) e.imp = 1; if (e.old) e.old = 1; if (e.wd) e.wd = 1;
      if (e.sr) { const o = {}; if (typeof e.sr === "object") for (const [n, v] of Object.entries(e.sr).slice(0, 60)) if (+n > 0 && +n < 100 && +v >= .5 && +v <= 5) o[+n] = Math.round(+v * 2) / 2; e.sr = o; }
      if (e.ss) { const o = {}; if (typeof e.ss === "object") for (const [n, d] of Object.entries(e.ss).slice(0, 60)) if (+n > 0 && +n < 100 && (d === "" || /^\d{4}-\d\d-\d\d$/.test(d))) o[+n] = d; e.ss = o; }
    }
    if (e.k === "list" || e.k === "unlist") { e.lid = String(e.lid || "").slice(0, 16); e.pv = String(e.pv || "").slice(0, 16); e.name = String(e.name || "").slice(0, 60); e.pt = Math.max(0, Math.min(99, +e.pt || 0)); e.np = Math.max(1, Math.min(100, +e.np || 1));
      e.items = Array.isArray(e.items) ? e.items.slice(0, 40).filter(m => m && (m.t === "movie" || m.t === "tv") && Number.isFinite(+m.i)).map(m => ({ t: m.t, i: +m.i, n: String(m.n || "").slice(0, 120), y: String(m.y || "").slice(0, 4), p: /^\/[\w.-]{1,60}$/.test(m.p) ? m.p : "" })) : []; }
    if (e.k === "sugdrop") e.sg = String(e.sg || "").slice(0, 16);
    if (e.k === "acc") { e.sg = String(e.sg || "").slice(0, 16); e.v = e.v ? 1 : 0; }
    if (e.k === "in" || e.k === "odate") { e.ok = String(e.ok || "").slice(0, 200); e.v = e.v ? 1 : 0; }
    if (e.k === "sug") { e.to = Array.isArray(e.to) ? e.to.slice(0, 30).map(x => String(x).slice(0, 16)) : []; e.d = /^\d{4}-\d\d-\d\d$/.test(e.d) ? e.d : ""; e.wk = e.wk ? 1 : 0; }
    if (e.sc) e.sc = typeof e.sc === "object" ? { c: String(e.sc.c || "").slice(0, 40), d: /^\d{4}-\d\d-\d\d$/.test(e.sc.d) ? e.sc.d : "", h: /^\d\d:\d\d$/.test(e.sc.h) ? e.sc.h : "", u: /^https:\/\//.test(e.sc.u) ? String(e.sc.u).slice(0, 300) : "" } : null;
    map[e.i] = e; fresh.push(e);
  }
  if (fresh.length) save(clubId);
  return fresh;
}

function derive(clubId) {
  const E = Object.values(evs(clubId)).filter(e => !e.gone).sort((x, y) => x.t - y.t || (x.i < y.i ? -1 : 1));
  // Watchlist adds from a file come in bursts (5+ within milliseconds); only a single, deliberate add can put a watched title back on your list.
  const bulkWl = new Set(); { const per = {}; for (const e of E) if (e.k === "wl") (per[e.a] ||= []).push(e); for (const xs of Object.values(per)) for (let i = 0, j = 0; i < xs.length; i = j) { j = i + 1; while (j < xs.length && xs[j].t - xs[j - 1].t <= 5) j++; if (j - i >= 5) for (let k = i; k < j; k++) bulkWl.add(xs[k].i); } }
  const club = clubs().find(c => c.id === clubId) || {};
  const s = { name: club.name, day: club.day ?? 0, members: new Map(), picks: {}, cur: -1, rounds: {}, mon: {}, saw: {}, wl: new Map(), sugs: [], talk: {}, outs: new Map(), acc: {}, clists: new Map(), rw: {}, sawAlt: {}, sawPrev: {} };
  const R = r => (s.rounds[r] ||= { noms: [], dropped: new Set(), votes: new Map(), seen: new Map(), says: [] });
  const unpickAt = {}, fixes = {}, films = new Set();
  for (const e of E) if (e.k === "unpick" && e.tr !== "m") unpickAt[e.r] = Math.max(unpickAt[e.r] || 0, e.t);
  for (let e of E) {
    s.members.set(e.a, { name: e.n || "Someone", last: e.t });
    if (e.k === "in" || e.k === "odate" || e.k === "ospot") {
      const o = s.outs.get(e.ok); if (!o) continue;
      if (e.k === "ospot") { o.spot = e.x; o.spotBy = e.n; continue; }
      if (e.k === "in") { if (e.v) o.ins.set(e.a, e.n || "Someone"); else o.ins.delete(e.a); }
      else if (e.sc) o.sc = e.sc;
      continue;
    }
    if (e.tr === "m" && e.k === "nom") { const ok = ckey(e); if (!s.outs.has(ok)) s.outs.set(ok, { ok, m: e.m, sc: e.sc, by: e.n || "Someone", a: e.a, at: e.t, ins: new Map([[e.a, e.n || "Someone"]]) }); }
    if (e.tr === "m" && e.k === "drop") s.outs.delete(ckey(e));
    if (e.tr === "m") {
      const mo = (s.mon[e.r] ||= { noms: [], dropped: new Set(), votes: new Map(), pick: null, go: new Map() });
      switch (e.k) {
        case "nom": if (!mo.noms.some(n => ckey(n) === ckey(e))) mo.noms.push({ m: e.m, sc: e.sc, by: e.n, a: e.a, at: e.t }); else mo.dropped.delete(ckey(e)); break;
        case "drop": mo.dropped.add(ckey(e)); break;
        case "vote": mo.votes.set(e.a, e.v || ""); break;
        case "pick": mo.pick = { ...e.m, sc: e.sc, by: e.n, at: e.t }; break;
        case "unpick": mo.pick = null; break;
        case "go": mo.go.set(e.a, { v: !!e.v, name: e.n }); break;
      }
      continue;
    }
    const rd = R(e.r);
    switch (e.k) {
      case "meta": if (e.name) s.name = String(e.name).slice(0, 40); if (e.day >= 0 && e.day <= 6) s.day = e.day; break;
      case "pick": if (e.t > (unpickAt[e.r] || 0) && !s.picks[e.r]) s.picks[e.r] = { ...e.m, by: e.n, at: e.t }; break;
      case "nom": if (!rd.noms.some(n => key(n.m) === key(e.m))) rd.noms.push({ m: e.m, by: e.n, a: e.a, at: e.t }); else rd.dropped.delete(key(e.m)); break;
      case "drop": rd.dropped.add(key(e.m)); break;
      case "vote": rd.votes.set(e.a, e.v || ""); break;
      case "seen": rd.seen.set(e.a, { s: e.s || 0, name: e.n }); break;
      case "say": if (e.sk) (s.talk[e.sk] ||= []).push(e); else rd.says.push(e); break;
      case "sug": if (e.m && e.d) s.sugs.push({ id: e.i, m: fixes[key(e.m)] || e.m, a: e.a, by: e.n || "Someone", to: e.to, d: e.d, wk: !!e.wk, at: e.t }); break;
      case "sugdrop": if (e.sg) { const m = (s.sugDrop ||= new Map()); (m.get(e.sg) || m.set(e.sg, new Set()).get(e.sg)).add(e.a); } break;
      case "acc": if (e.sg) (s.acc[e.sg] ||= new Map()).set(e.a, { v: !!e.v, at: e.t, name: e.n }); break;
      // "fix": someone swapped a wrong match (e.g. the 2002 film for the 2026 series) for everyone.
      // "list" { lid, pv, name, pt, np, items }: a list published for the club, split into parts (ntfy messages are small); "unlist" { lid } takes it back.
      case "list": if (e.lid && e.pv) { const o = s.clists.get(e.lid); if (!o || o.pv < e.pv) s.clists.set(e.lid, { lid: e.lid, pv: e.pv, name: e.name, np: e.np, at: e.t, a: e.a, by: e.n, parts: { [e.pt]: e.items } }); else if (o.pv === e.pv) o.parts[e.pt] = e.items; } break;
      case "unlist": if (e.lid) s.clists.delete(e.lid); break;
      case "film": if (e.from) { e.v ? films.add(e.from) : films.delete(e.from); } break;
      case "fix": if (e.from && e.m && e.from !== key(e.m)) {
        const k2 = key(e.m), w = s.wl.get(e.from); fixes[e.from] = e.m;
        if (w) { s.wl.delete(e.from); const t = s.wl.get(k2); if (t) for (const [a, n] of w.adders) t.adders.set(a, n); else s.wl.set(k2, { ...w, m: e.m }); }
        for (const g of s.sugs) if (key(g.m) === e.from) g.m = e.m;
      } break;
      case "wl": if (e.m) { if (fixes[key(e.m)]) e = { ...e, m: fixes[key(e.m)] }; const k = key(e.m), w = s.wl.get(k) || { m: e.m, adders: new Map(), addAt: new Map(), addT: new Map(), at: e.t }; w.adders.set(e.a, e.n || "Someone"); (w.addT ||= new Map()).set(e.a, e.t); if (!bulkWl.has(e.i)) w.addAt.set(e.a, e.t); s.wl.set(k, w); } break;
      case "wldrop": if (e.m && fixes[key(e.m)]) e = { ...e, m: fixes[key(e.m)] }; if (e.m) s.wl.get(key(e.m))?.adders.delete(e.a); break;
      case "saw": if (e.sk) { const p0 = s.saw[e.sk]?.get(e.a); // "rw": watched it again; keep the earlier watch on the wall
        // A different film with the same name (e.g. Resident Evil 2002 vs 2026) never overwrites a real log of the other one: it's kept on the side.
        if (e.v && e.m && p0?.v && p0.m && key(p0.m) !== key(e.m) && (p0.d || p0.s || p0.x || p0.ss) && !p0.imp && !(fixes[key(p0.m)] && key(fixes[key(p0.m)]) === key(e.m))) { (s.sawAlt[key(e.m)] ||= new Map()).set(e.a, { v: 1, at: e.t, m: e.m, s: +e.s || 0, old: !!e.old, d: e.d || "" }); break; }
        if (e.v && e.m && s.sawAlt[key(e.m)]?.has(e.a)) s.sawAlt[key(e.m)].delete(e.a);
        // Remember a real log (date, stars or review) that a later change wiped, so it can be brought back from the title sheet.
        if (p0?.v && !p0.imp && (p0.d || p0.x || p0.s) && (!e.v || (p0.x && !e.x) || (p0.d && !e.d && !e.old) || (p0.m && e.m && key(p0.m) !== key(e.m)))) (s.sawPrev[e.sk] ||= new Map()).set(e.a, { ...p0 });
        if (!e.v) s.rw[e.sk]?.delete(e.a);
        else if (e.rw && p0?.v) { const r = (s.rw[e.sk] ||= new Map()), o = r.get(e.a) || { n: 0, past: [] }; o.n++; const d0 = p0.old || p0.imp ? "" : p0.d || iso(new Date(p0.at || 0)); if (d0) o.past.push({ d: d0, s: p0.s, x: p0.x }); r.set(e.a, o); } }
      if (e.sk) (s.saw[e.sk] ||= new Map()).set(e.a, { v: !!e.v, name: e.n, at: e.t, s: e.v ? Math.max(0, Math.min(5, Math.round((+e.s || 0) * 2) / 2)) : 0, x: e.v ? e.x || "" : "", d: e.v ? e.d || "" : "", imp: !!e.imp, old: !!e.old, wd: e.v ? (e.wd && e.d ? e.d : s.saw[e.sk].get(e.a)?.wd || "") : "", m: e.m || s.saw[e.sk].get(e.a)?.m || null, ss: e.v ? e.ss || null : null, sr: e.v ? e.sr || null : null }); break;
    }
  }
  // A title someone has watched leaves their watchlist (old imports also put every rated film on it).
  for (const w of s.wl.values()) for (const a of [...w.adders.keys()]) { const x = s.saw[seenKey(w.m.n)]?.get(a); if (x?.v && (!x.m || key(x.m) === key(w.m)) && !((w.addAt?.get(a) || 0) > (x.at || 0))) w.adders.delete(a); } // adding it again after watching keeps it on your list
  for (const [k, w] of s.wl) if (!w.adders.size) s.wl.delete(k);
  if (s.sugDrop) s.sugs = s.sugs.filter(g => !s.sugDrop.get(g.id)?.has(g.a)); // the sender takes it back for everyone; a recipient's drop only hides it for them (see sugTo)
  const rs = Object.keys(s.picks).map(Number);
  s.cur = rs.length ? Math.max(...rs) : -1;
  s.round = r => R(r);
  // Old imports weren't flagged: anything marked watched in a burst (5+ titles within milliseconds) came from a file, so treat it as imported everywhere.
  const per = {}; for (const mp of Object.values(s.saw)) for (const [id, x] of mp) if (x.v && !x.imp) (per[id] ||= []).push(x);
  for (const xs of Object.values(per)) { xs.sort((a, b) => a.at - b.at); for (let i = 0, j = 0; i < xs.length; i = j) { j = i + 1; while (j < xs.length && xs[j].at - xs[j - 1].at <= 5) j++; if (j - i >= 5) for (let k = i; k < j; k++) xs[k].imp = true; } }
  if (clubId === activeId || clubId === active()?.id) asFilm = films;
  s.films = films;
  s.owner = E.find(e => e.k === "meta")?.a || "";
  s.pub = [...s.clists.values()].map(o => ({ id: o.lid, name: o.name, by: o.by, a: o.a, at: o.at, pv: o.pv, club: 1, items: Object.keys(o.parts).sort((x, y) => x - y).flatMap(k => o.parts[k]).filter((m, i, a) => a.findIndex(x => key(x) === key(m)) === i) })).filter(l => l.items.length).sort((a, b) => b.at - a.at);
  return s;
}
// Next week's pick is voted on straight from the club watchlist (older nominations still count).
// Only titles with at least one vote are candidates; most votes first, ties go to whatever was added first.
function tallyW(s, rd) {
  const count = {}; for (const v of rd.votes.values()) if (v) count[v] = (count[v] || 0) + 1;
  const map = new Map();
  for (const w of [...s.wl.values()].sort((a, b) => a.at - b.at)) map.set(key(w.m), { m: w.m, by: [...w.adders.values()][0], a: [...w.adders.keys()][0], at: w.at });
  for (const n of rd.noms) if (!rd.dropped.has(key(n.m)) && !map.has(key(n.m))) map.set(key(n.m), n);
  return [...map.values()].map((n, idx) => ({ ...n, votes: count[key(n.m)] || 0, idx })).filter(x => x.votes > 0).sort((a, b) => b.votes - a.votes || a.idx - b.idx);
}
// Candidates for the next movie, most votes first; ties go to whoever was nominated first.
function tally(rd) {
  const noms = rd.noms.filter(n => !rd.dropped.has(key(n.m)));
  const count = {}; for (const v of rd.votes.values()) if (v) count[v] = (count[v] || 0) + 1;
  return noms.map((n, idx) => ({ ...n, votes: count[key(n.m)] || 0, idx })).sort((a, b) => b.votes - a.votes || a.idx - b.idx);
}

// ---------- sync ----------
const topic = id => "mqc_" + id;
const newsTopic = id => "mqc_" + id + "_news";
async function post(body) {
  const r = await fetch(NTFY, { method: "POST", body: JSON.stringify(body) });
  if (!r.ok) throw new Error("ntfy " + r.status);
}
async function send(clubId, list) {
  list = list.filter(e => !e.demo); if (!list.length) return;
  // Keep each message well under ntfy's 4 KB limit.
  const chunks = []; let cur = [];
  for (const e of list) {
    cur.push(e);
    if (cur.length > 1 && (TAG + b64(cur)).length > 3400) { cur.pop(); chunks.push(cur); cur = [e]; }
  }
  if (cur.length) chunks.push(cur);
  for (const c of chunks) await post({ topic: topic(clubId), message: TAG + b64(c) });
}
function parseMsg(text) {
  if (typeof text !== "string" || !text.startsWith(TAG)) return [];
  try { const a = unb64(text.slice(TAG.length)); return Array.isArray(a) ? a : []; } catch { return []; }
}
const pulling = {};
async function pull(clubId) {
  if (pulling[clubId]) return pulling[clubId];
  return (pulling[clubId] = (async () => {
    try {
      const r = await fetch(`${NTFY}/${topic(clubId)}/json?poll=1&since=all`);
      if (!r.ok) throw new Error("ntfy " + r.status);
      const inWindow = new Set(); let incoming = [];
      for (const line of (await r.text()).split("\n")) {
        if (!line) continue;
        try { const m = JSON.parse(line); if (m.event === "message") parseMsg(m.message).forEach(e => { if (e && e.i) inWindow.add(e.i); incoming.push(e); }); } catch {}
      }
      const fresh = merge(clubId, incoming);
      setOnline(true);
      await reseed(clubId, inWindow);
      announce(clubId, fresh);
      return fresh;
    } catch (e) { setOnline(false); return []; }
    finally { delete pulling[clubId]; }
  })());
}
// Re-send what the topic has forgotten: the club's settings, every pick, and everything from the
// current and previous week. Older chat stays on members' devices.
async function reseed(clubId, inWindow) {
  const s = derive(clubId), keepFrom = s.cur - 1;
  const all = Object.values(evs(clubId)).filter(e => !e.gone);
  const latestMeta = all.filter(e => e.k === "meta").sort((a, b) => b.t - a.t)[0];
  const want = all.filter(e => e === latestMeta || e.k === "pick" || e.k === "unpick" || e.k === "wl" || e.k === "wldrop" || e.k === "saw" || e.k === "sug" || e.k === "sugdrop" || e.k === "acc" || e.k === "fix" || e.k === "film" || e.k === "unlist" || (e.k === "list" && s.clists.get(e.lid)?.pv === e.pv) || e.k === "in" || e.k === "odate" || e.k === "ospot" || (e.tr === "m" && (e.k === "nom" || e.k === "drop")) || (e.k === "say" && e.sk) || (e.k !== "meta" && e.r >= keepFrom));
  const missing = want.filter(e => !inWindow.has(e.i)).sort((a, b) => a.t - b.t);
  if (!missing.length) return;
  try { await send(clubId, missing); } catch {}
}

let es = null, esClub = null;
function live() {
  const c = active();
  const want = c && me && document.visibilityState === "visible" ? c.id : null;
  if (want === esClub) return;
  if (es) { es.close(); es = null; }
  esClub = want;
  if (!want || !("EventSource" in window)) return;
  es = new EventSource(`${NTFY}/${topic(want)}/sse`);
  es.onmessage = ev => {
    try {
      const m = JSON.parse(ev.data);
      if (m.event && m.event !== "message") return;
      const fresh = merge(want, parseMsg(m.message));
      if (fresh.length) { announce(want, fresh); render(); }
    } catch {}
  };
  es.onopen = () => setOnline(true);
}
let online = true;
function setOnline(v) { if (online === v) return; online = v; const n = $("clubOffline"); if (n) n.hidden = v; }

async function act(kind, fields = {}, news) {
  const c = active(); if (!c || !me) return;
  const s = derive(c.id);
  const e = { i: rand(10), k: kind, a: me.id, n: me.name, t: now(), r: s.cur, ...fields };
  merge(c.id, [e]); markRead(); render();
  try {
    await send(c.id, [e]);
    if (news) { post({ topic: newsTopic(c.id), title: `${s.name || "Movie club"}: ${news.title}`, message: news.body || "Tap to open the club.", click: APP_URL + "?view=" + (news.view || "club"), tags: ["clapper"] }).catch(() => {}); pushNews(s, news); }
  } catch { M.toast("Saved here. It'll reach the club when you're back online."); }
}

// Many events at once (e.g. a whole IMDb watchlist): one merge, one redraw, one send.
async function actMany(items, news) {
  const c = active(); if (!c || !me || !items.length) return;
  const s = derive(c.id), t = now();
  const list = items.map(([kind, fields], i) => ({ i: rand(10), k: kind, a: me.id, n: me.name, t: t + i, r: s.cur, ...fields }));
  merge(c.id, list); markRead(); render();
  try {
    await send(c.id, list);
    if (news) { post({ topic: newsTopic(c.id), title: `${s.name || "Movie club"}: ${news.title}`, message: news.body || "Tap to open the club.", click: APP_URL + "?view=" + (news.view || "club"), tags: ["clapper"] }).catch(() => {}); pushNews(s, news); }
  } catch { M.toast("Saved here. It'll reach the club when you're back online."); }
}

// Push notifications (when Marquee is closed) go through push.js: a queue in Firestore that a GitHub job sends every few minutes.
const realIds = s => [...s.members.keys()].filter(id => id !== me.id && !id.startsWith("demo_"));
function pushNews(s, news) {
  const to = (news.to || realIds(s)).filter(id => id !== me.id && !id.startsWith("demo_"));
  if (!to.length || !window.MarqueePush) return;
  window.MarqueePush.send({ to, title: `${s.name || "Movie club"}: ${news.title}`, body: news.body || "Tap to open the club.", ...(news.view ? { url: "./?view=" + news.view } : {}), ...(news.at ? { at: news.at } : {}), ...(news.id ? { id: news.id } : {}) });
}

// ---------- unread badge & alerts ----------
const readKey = id => "marqueeClubRead_" + id;
function unread(clubId) {
  const since = LS.get(readKey(clubId), 0);
  return Object.values(evs(clubId)).filter(e => e.a !== me?.id && e.t > since && (e.k === "say" || e.k === "nom" || e.k === "pick")).length;
}
function markRead() { const c = active(); if (c && document.body.dataset.view === "club") LS.set(readKey(c.id), now()); badge(); }
function badge() {
  const n = me ? clubs().reduce((a, c) => a + unread(c.id), 0) : 0;
  const b = $("clubBadge"); if (!b) return;
  b.hidden = !n; b.textContent = n > 9 ? "9+" : n;
}
function announce(clubId, fresh) {
  const others = fresh.filter(e => e.a !== me?.id && now() - e.t < 36e5 * 6);
  if (!others.length) { badge(); return; }
  if (document.body.dataset.view !== "club" || document.visibilityState !== "visible") {
    const p = others.find(e => e.k === "pick"), say = others.filter(e => e.k === "say").pop(), nom = others.find(e => e.k === "nom");
    const msg = p ? `Next movie: ${p.m.n}` : say ? `${say.n}: ${say.x.slice(0, 60)}` : nom ? `${nom.n} nominated ${nom.m.n}` : "";
    if (msg) M.toast(msg);
  }
  markRead();
}

// ---------- links ----------
const inviteUrl = c => `${APP_URL}?club=${b64({ c: c.id, n: c.name, d: c.day })}`;
let pendingInvite = (() => {
  const q = new URLSearchParams(location.search), v = q.get("club");
  if (!v) return null;
  history.replaceState(null, "", location.pathname); M.setView("club");
  try { const p = unb64(v); if (typeof p.c === "string" && /^[a-z0-9]{8,32}$/.test(p.c)) return { id: p.c, name: String(p.n || "Movie club").slice(0, 40), day: +p.d || 0 }; } catch {}
  M.toast("That club link looks broken. Ask for a new one."); return null;
})();
async function shareText(text, url) {
  if (navigator.share) { try { await navigator.share({ text, url }); return; } catch (e) { if (e?.name === "AbortError") return; } }
  try { await navigator.clipboard.writeText(url ? text + " " + url : text); M.toast("Copied. Paste it in your group chat."); }
  catch { prompt("Copy this and send it to your group:", url ? text + " " + url : text); }
}
function nightAfter(t, day) {
  const d = new Date(t); d.setHours(12, 0, 0, 0);
  const add = (day - d.getDay() + 7) % 7 || 7;
  d.setDate(d.getDate() + add);
  return d;
}
const nightLabel = d => d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });

// ---------- search sheet ----------
function openSearch(title, onPick, initial = "", foot = null) {
  const bg = el(`<div class="sheet-bg"><div class="sheet" role="dialog" aria-label="${esc(title)}">
    <h3>${esc(title)}</h3>
    <input type="search" id="clubQ" placeholder="Search, or paste an IMDb link" autocomplete="off">
    <div class="results" id="clubRes"><p class="hint">Start typing a title.</p></div>
    ${foot ? foot.html : ""}<button id="clubCancel">Cancel</button></div></div>`);
  document.body.appendChild(bg);
  const close = () => bg.remove();
  if (foot) bg.querySelectorAll("[data-foot]").forEach(b => b.onclick = () => { close(); foot.on(b.dataset.foot); });
  bg.addEventListener("click", e => { if (e.target === bg) close(); });
  bg.querySelector("#clubCancel").onclick = close;
  const q = bg.querySelector("#clubQ"), res = bg.querySelector("#clubRes");
  let timer = 0, seq = 0, items = [];
  q.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const text = q.value.trim(), my = ++seq;
      if (text.length < 2) { res.innerHTML = `<p class="hint">Start typing a title.</p>`; return; }
      try {
        // An IMDb or TMDB link (or tt-id) finds that exact title; otherwise films and series are searched separately too,
        // so a small film doesn't get pushed out by a series with the same name.
        const tl = text.match(/themoviedb\.org\/(movie|tv)\/(\d+)/i), il = text.match(/(tt\d{5,})/i);
        let raw;
        if (tl) { const j = await M.tm(`/${tl[1].toLowerCase()}/${tl[2]}`); raw = [{ ...j, media_type: tl[1].toLowerCase() }]; }
        else if (il) { const f = await M.tm("/find/" + il[1], { external_source: "imdb_id" }); raw = [...(f.movie_results || []).map(x => ({ ...x, media_type: "movie" })), ...(f.tv_results || []).map(x => ({ ...x, media_type: "tv" }))]; }
        else {
          const [d, dm, dt] = await Promise.all([M.tm("/search/multi", { query: text, include_adult: "false" }), M.tm("/search/movie", { query: text, include_adult: "false" }).catch(() => ({})), M.tm("/search/tv", { query: text, include_adult: "false" }).catch(() => ({}))]);
          const seenK = new Set(); raw = [];
          for (const x of [...(d.results || []), ...(dm.results || []).slice(0, 4).map(x => ({ ...x, media_type: "movie" })), ...(dt.results || []).slice(0, 4).map(x => ({ ...x, media_type: "tv" }))]) { const k = x.media_type + ":" + x.id; if (!seenK.has(k)) { seenK.add(k); raw.push(x); } }
        }
        if (my !== seq) return;
        items = raw.filter(x => x.media_type === "movie" || x.media_type === "tv").slice(0, 16)
          .map(x => ({ t: x.media_type, i: x.id, n: x.title || x.name, y: (x.release_date || x.first_air_date || "").slice(0, 4), p: x.poster_path || "" }));
        res.innerHTML = items.length ? items.map((m, i) => `<button data-i="${i}">${poster(m.p, "w92")}<span><b>${esc(m.n)}</b><br><small class="hint">${m.t === "tv" ? "📺 Series" : "🎬 Film"}${m.y ? ` · ${esc(m.y)}` : ""}</small></span></button>`).join("") : `<p class="hint">Nothing found.</p>`;
      } catch { res.innerHTML = `<p class="hint">Search isn't working right now. Check your connection.</p>`; }
    }, 300);
  });
  res.addEventListener("click", e => { const b = e.target.closest("[data-i]"); if (b) { close(); onPick(items[+b.dataset.i]); } });
  if (initial) { q.value = initial; q.dispatchEvent(new Event("input")); }
  setTimeout(() => q.focus(), 50);
}

// ---------- screens ----------
const openPast = new Set();
let showStart = false;
let peek = {};

function keepInputs(fn) {
  // Live updates re-draw the page; don't lose what someone is typing.
  const vals = {}; document.querySelectorAll("#clubView input[id], #histView input[id]").forEach(i => vals[i.id] = i.value);
  const focus = document.activeElement?.id, pos = document.activeElement?.selectionStart;
  fn();
  Object.entries(vals).forEach(([id, v]) => { const i = $(id); if (i && i.type !== "checkbox" && i.type !== "file" && v) i.value = v; });
  if (focus && $(focus)) { $(focus).focus(); try { $(focus).setSelectionRange(pos, pos); } catch {} }
}

function renderStart() {
  const inv = pendingInvite;
  view.innerHTML = `
    <h2>Movie club</h2>
    <p>Like a book club, but for movies. Vote on a film or series to watch at home and talk about it here, and pick a film to go see together at the cinema. No accounts, nothing to install.</p>
    ${inv ? `<div class="fr-card">
      <h3>You're invited to ${esc(inv.name)}</h3>
      <label>Your name (the club sees this) <input type="text" id="cbName" maxlength="40" value="${esc(defaultName())}" placeholder="e.g. Bram"></label>
      <button class="primary" id="cbJoin">Join ${esc(inv.name)}</button>
    </div>` : ""}
    <div class="fr-card">
      <h3>${inv ? "Or start your own club" : "Start a club"}</h3>
      ${inv ? "" : `<label>Your name (the club sees this) <input type="text" id="cbName" maxlength="40" value="${esc(defaultName())}" placeholder="e.g. Bram"></label>`}
      <label>Club name <input type="text" id="cbClub" maxlength="40" placeholder="e.g. Sunday Screenings"></label>
      <button class="${inv ? "" : "primary"}" id="cbCreate">Start the club</button>
      ${showStart && clubs().length ? `<button class="link" id="cbBack">Back to my club</button>` : ""}
      <p class="hint">You'll get a link to drop in your WhatsApp group. Anyone with the link can join and read the club, so only share it with your group.</p>
    </div>`;
  $("cbBack")?.addEventListener("click", () => { showStart = false; render(); });
  const nameOk = () => { const n = $("cbName").value.trim(); if (!n) { M.toast("Type your name first."); $("cbName").focus(); } return n; };
  $("cbJoin")?.addEventListener("click", async () => {
    const n = nameOk(); if (!n) return;
    ensureMe(n); addClub(inv); pendingInvite = null; showStart = false;
    render(); await pull(inv.id);
    const s = derive(inv.id); if (![...s.members.keys()].includes(me.id)) act("join");
    live(); render();
  });
  $("cbCreate").onclick = () => {
    const n = nameOk(); if (!n) return;
    const name = $("cbClub").value.trim() || "Movie club", day = 0;
    ensureMe(n); const c = { id: rand(20), name, day }; addClub(c); pendingInvite = null; showStart = false;
    act("meta", { name, day }); live(); render();
    setTimeout(() => shareInvite(c, true), 300);
  };
}

function shareInvite(c, first) {
  if (first) M.toast("Club started. Send the link to your group.");
  shareText(`Join our movie club "${c.name}" on Marquee: we watch one movie a week, vote on the next one and talk about it.`, inviteUrl(c));
}


document.addEventListener("marquee:view", e => { if (e.detail === "settings") renderSettingsExtras(); });
function render() {
  badge(); renderSettingsExtras();
  if (showStart || !me || !clubs().length || pendingInvite && !clubs().some(c => c.id === pendingInvite.id)) {
    renderStart();
    hist.innerHTML = `<div class="fr-card"><h3>No history yet</h3><p class="hint">Start or join a movie club, and every movie the group votes on shows up here.</p><button class="primary" id="hsGo">Go to the club</button></div>`;
    $("hsGo").onclick = () => M.setView("club");
    if (listsEl) listsEl.innerHTML = `<div class="fr-card"><h3>Lists</h3><p class="hint">Start or join a movie club first. Then you can import lists, make your own and add ready-made ones like the Oscar winners.</p></div>`;
    if (lead) lead.innerHTML = `<div class="fr-card"><h3>No leaderboard yet</h3><p class="hint">Start or join a movie club first. Then everyone's watching, reviews and outings get ranked here.</p></div>`;
    if (mwView) mwView.innerHTML = `<div class="fr-card"><h3>My watched list</h3><p class="hint">Start or join a movie club first, then everything you watch is logged here with its date.</p></div>`;
    return;
  }
  if (pendingInvite) { activeId = pendingInvite.id; LS.set("marqueeClubActive", activeId); pendingInvite = null; }
  syncSaved(); repairImdbWatchlist();
  keepInputs(renderClub);
}
// Titles saved with "+ Watchlist" on the poster page also belong on your Personal watchlist in the club.
// Each one is copied once per club (so taking it off the club list later sticks), skipping titles you already watched or dropped.
// Repair (v111): IMDb watchlist imports were marked as watched. Unrated IMDb imports go back to the Personal watchlist.
function repairImdbWatchlist() {
  const c = active(); if (!c || !me || LS.get("marqueeFixImdb_" + c.id, false)) return;
  LS.set("marqueeFixImdb_" + c.id, true);
  const map = evs(c.id), back = []; let n = 0;
  for (const [i, e] of Object.entries(map)) if (!e.gone && e.a === me.id && e.k === "saw" && e.imp && e.m?.im && !e.s && !e.d) { map[i] = { ...e, gone: "imdbwl" }; back.push(e.m); n++; }
  if (!n) return;
  save(c.id);
  const have = new Set(Object.values(map).filter(e => !e.gone && e.a === me.id && e.k === "wl" && e.m).map(e => key(e.m)));
  const add = back.filter(m => !have.has(key(m)));
  if (add.length) actMany(add.map(m => ["wl", { m }]), null); else render();
  M.toast(`Fixed: ${n} title${n === 1 ? "" : "s"} from your IMDb watchlist ${n === 1 ? "was" : "were"} wrongly marked as watched. ${n === 1 ? "It's" : "They're"} back on your Personal watchlist.`);
}
let syncingSaved = false;
// The poster page's "+ Personal watchlist" button goes straight onto your list in the active club.
M.clubList = {
  ready: () => !!(active() && me),
  has: m => { const c = active(); return !!(c && me && derive(c.id).wl.get(key(m))?.adders.has(me.id)); },
  toggle: m => { const on = M.clubList.has(m); act(on ? "wldrop" : "wl", { m }); M.toast(on ? `${m.n} removed from your Personal watchlist.` : `${m.n} added to your Personal watchlist.`); return !on; },
};
function syncSaved() {
  const c = active(); if (!c || !me || syncingSaved) return;
  const saved = LS.get("marqueeWatchlist", []).filter(x => x && x.id && (x.type === "movie" || x.type === "tv"));
  if (!saved.length) return;
  const done = new Set(LS.get("marqueeWlSaved_" + c.id, []));
  const mine = Object.values(evs(c.id)).filter(e => e.a === me.id && !e.gone);
  const had = new Set(mine.filter(e => (e.k === "wl" || e.k === "wldrop") && e.m).map(e => key(e.m)));
  const seen = new Set(mine.filter(e => e.k === "saw" && e.v).map(e => e.sk));
  const fresh = [];
  for (const x of saved) {
    const m = { t: x.type, i: x.id, n: x.title || "", y: String(x.year || ""), p: x.poster || "" }, k = key(m);
    if (done.has(k)) continue; done.add(k);
    if (!had.has(k) && !seen.has(seenKey(m.n))) fresh.push(m);
  }
  LS.set("marqueeWlSaved_" + c.id, [...done]);
  if (!fresh.length) return;
  syncingSaved = true;
  try { actMany(fresh.map(m => ["wl", { m }]), { title: `${me.name} added ${fresh.length} title${fresh.length === 1 ? "" : "s"} to the club watchlist`, body: "From their Marquee watchlist" }); }
  finally { syncingSaved = false; }
}

function donut(parts, total, label) {
  const R = 54, C = 2 * Math.PI * R; let off = 0;
  const segs = total ? parts.filter(p => p.v).map(p => { const len = p.v / total * C; const seg = `<circle r="${R}" cx="70" cy="70" fill="none" stroke="${p.c}" stroke-width="22" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}"><title>${esc(p.n)}: ${p.v}</title></circle>`; off += len; return seg; }).join("") : "";
  return `<svg class="donut" viewBox="0 0 140 140" role="img" aria-label="${esc(label)}">
    <circle r="${R}" cx="70" cy="70" fill="none" stroke="var(--field)" stroke-width="22"/>
    <g transform="rotate(-90 70 70)">${segs}</g>
    <text x="70" y="68" text-anchor="middle" class="dn">${total}</text><text x="70" y="88" text-anchor="middle" class="dl">${total === 1 ? "vote" : "votes"}</text></svg>`;
}

// ---------- calendar ----------
const CAL = { home: { off: 0, sel: null }, cine: { off: 0, sel: null } };
let calNominate = () => {};
// Ghent cinema listings: screenings.json is refreshed daily by a GitHub Action (scripts/cinemas.mjs).
const CINEMAS = ["KASKcinema", "Sphinx", "Studio Skoop", "Kinepolis Gent", "Elsewhere"];
// One-off screenings (o: 1) come from UiT in Vlaanderen and are grouped under one filter chip.
const chipOf = x => x.o ? (/kinepolis/i.test(x.c) ? "Kinepolis Gent" : "Elsewhere") : x.c;
let cine = null, cineByDay = {};
// Kinepolis Gent's own programme can't be read automatically, so its films come from TMDB's Belgian release dates:
// a film shows as "Opens" on its release day and as "Showing" for five weeks after. Times are on Kinepolis's site.
let kp = [], kpAll = false;
const KP_RUN = 35;
const kpOn = () => !cineOff().has("Kinepolis Gent");
const dayDiff = (a, b) => Math.round((new Date(a + "T12:00") - new Date(b + "T12:00")) / 864e5);
const kpOpening = d => kpOn() ? kp.filter(f => f.d === d) : [];
const kpRunning = d => kpOn() ? kp.filter(f => f.d < d && dayDiff(d, f.d) <= KP_RUN) : [];
// TMDB falls back to the original script (Japanese, Korean…) when a film has no Dutch title, so fetch English too and
// use the first title written in Latin letters.
const latin = t => !!t && /^[\p{Script=Latin}\p{N}\p{P}\p{S}\s]+$/u.test(t);
async function kpList(path, page = 1) {
  const [nl, en] = await Promise.all([M.tm(path, { region: "BE", language: "nl-BE", page }), M.tm(path, { region: "BE", language: "en-US", page }).catch(() => ({ results: [] }))]);
  const ens = new Map((en.results || []).map(x => [x.id, x]));
  return (nl.results || []).map(x => {
    const e = ens.get(x.id) || {};
    const n = [x.title, e.title, x.original_title].find(latin) || e.title || x.title;
    return { d: x.release_date || "", m: { t: "movie", i: x.id, n, y: (x.release_date || "").slice(0, 4), p: x.poster_path || e.poster_path || "" } };
  });
}
async function loadKp() {
  const seen = new Set(), out = [];
  for (const [path, page] of [["/movie/now_playing", 1], ["/movie/now_playing", 2], ["/movie/upcoming", 1], ["/movie/upcoming", 2]]) {
    try {
      for (const f of await kpList(path, page)) if (f.d && !seen.has(f.m.i)) { seen.add(f.m.i); out.push(f); }
    } catch {}
  }
  kp = out.sort((a, b) => a.d.localeCompare(b.d) || a.m.n.localeCompare(b.m.n));
  const box = $("cbCal"); if (box && box._redraw) box._redraw();
}
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const cineOff = () => new Set(LS.get("marqueeCinemasOff", []));
function indexCine() {
  const off = cineOff(); cineByDay = {};
  for (const x of cine?.screenings || []) if (!off.has(chipOf(x))) (cineByDay[x.d] ||= []).push(x);
}
async function loadCine() {
  for (const u of ["https://raw.githubusercontent.com/poldendrol/Postermaker/main/screenings.json", "screenings.json"]) {
    try { const r = await fetch(u, { cache: "no-cache" }); if (!r.ok) continue; cine = await r.json(); indexCine(); const box = $("cbCal"); if (box && box._redraw) box._redraw(); return; } catch {}
  }
}
let calAll = LS.get("marqueeCalAll2", true); // false: the cinema calendar shows outings and Kinepolis releases only
function cineHtml(dayIso) {
  if (!cine && !kp.length) return "";
  const off = cineOff();
  const have = new Set((cine?.screenings || []).map(chipOf)); if (kp.length) have.add("Kinepolis Gent");
  const opens = kpOpening(dayIso), running = kpRunning(dayIso);
  const kpFilm = (f, tag) => `<div class="cine-f"><span class="ct">${tag}</span><a href="${esc(KP_URL)}" target="_blank" rel="noopener">${esc(f.m.n)}</a><span class="cf-acts"><button class="link" data-cn="${esc(JSON.stringify({ c: "Kinepolis Gent", d: dayIso, t: f.m.n, u: KP_URL, h: [] }))}" title="Suggest for cinema night" aria-label="Suggest for cinema night">+🎟</button></span></div>`;
  const kpHtml = opens.length || running.length ? `<div class="cine-c"><span class="cine-name">Kinepolis Gent <small class="hint">times on Kinepolis</small></span>${opens.map(f => kpFilm(f, "Opens")).join("")}${running.slice(0, kpAll ? 99 : 8).map(f => kpFilm(f, "Showing")).join("")}${!kpAll && running.length > 8 ? `<button class="link" id="kpMore">+ ${running.length - 8} more</button>` : ""}</div>` : "";
  const chips = `<div class="cine-chips">${CINEMAS.filter(c => have.has(c)).map(c => `<button class="chip${off.has(c) ? "" : " on"}" data-cine="${esc(c)}" aria-pressed="${!off.has(c)}">${esc(c)}</button>`).join("")}</div>`;
  const list = calAll ? cineByDay[dayIso] || [] : [];
  if (!list.length) return `<div class="cine"><b class="cine-h">Film in Ghent</b>${calAll ? chips : ""}${kpHtml || `<small class="hint">${calAll ? "No screenings listed for this day." : "Nothing opening this day."}</small>`}<a class="link kp-link" href="https://kinepolis.be/nl/bioscopen/kinepolis-gent" target="_blank" rel="noopener">Kinepolis Gent full programme ↗</a></div>`;
  const by = {};
  for (const x of list) { const f = ((by[x.c] ||= {})[x.t] ||= { t: x.t, u: x.u, h: [] }); if (x.h && !f.h.includes(x.h)) f.h.push(x.h); }
  return `<div class="cine"><b class="cine-h">Film in Ghent</b>${chips}${Object.entries(by).map(([c, films]) => `<div class="cine-c"><span class="cine-name">${esc(c)}</span>
    ${Object.values(films).map(f => `<div class="cine-f"><span class="ct">${f.h.join(" · ") || "–"}</span><a href="${esc(f.u)}" target="_blank" rel="noopener">${esc(f.t)}</a><span class="cf-acts"><button class="link" data-cn="${esc(JSON.stringify({ c, d: dayIso, t: f.t, u: f.u, h: f.h }))}" title="Suggest this screening for cinema night" aria-label="Suggest for cinema night">+🎟</button></span></div>`).join("")}</div>`).join("")}${kpHtml}
    <a class="link kp-link" href="https://kinepolis.be/nl/bioscopen/kinepolis-gent" target="_blank" rel="noopener">Kinepolis Gent full programme ↗</a>
    <small class="hint">From the cinemas' own sites and UiT in Vlaanderen, updated every morning. Kinepolis films from TMDB release dates.</small></div>`;
}
const ymd = d => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
// Suggestions: who it's for, whether they've seen it, and the days it comes up (once, or weekly until seen).
const sugTo = (s, g) => { const gone = s.sugDrop?.get(g.id); return (g.to.includes("*") ? [...s.members.keys()].filter(id => id !== g.a) : g.to.filter(id => s.members.has(id) || id === me.id)).filter(id => !gone?.has(id)); };
const sawAt = (s, m, id) => { const x = s.saw[seenKey(m.n)]?.get(id); return x?.v ? x.at || 1 : 0; };
const sugOpen = (s, g, id) => !sawAt(s, g.m, id);
// The same title suggested twice (by one friend or several) shows once: "From Emma and Rikkert".
const dedupeSugs = list => { const by = new Map(); for (const g of list) { const k = key(g.m), o = by.get(k); if (!o) by.set(k, { ...g, ids: [g.id], froms: [g.by] }); else { o.ids.push(g.id); if (!o.froms.includes(g.by)) o.froms.push(g.by); o.by = o.froms.join(" and "); } } return [...by.values()]; };
const sugForMe = s => dedupeSugs(s.sugs.filter(g => g.a !== me.id && sugTo(s, g).includes(me.id) && sugOpen(s, g, me.id)).sort((a, b) => a.d.localeCompare(b.d)));
const sugMine = s => s.sugs.filter(g => g.a === me.id && sugTo(s, g).some(id => sugOpen(s, g, id)));
// Suggestions to me that I've already seen stay visible (greyed, with "✓ Seen" to undo a misclick).
const sugSent = s => s.sugs.filter(g => g.a === me.id).sort((a, b) => b.at - a.at); // including ones everybody has watched
const isoAdd = (d, n) => { const x = new Date(d + "T12:00"); x.setDate(x.getDate() + n); return iso(x); };
function sugDays(g, from, to) {
  const out = []; if (!g.wk) { if (g.d >= from && g.d <= to) out.push(g.d); return out; }
  let d = g.d; if (d < from) { const skip = Math.ceil(dayDiff(from, d) / 7); d = isoAdd(d, skip * 7); }
  for (; d <= to; d = isoAdd(d, 7)) out.push(d);
  return out;
}
// Accepting a suggestion means watching it within a week of accepting.
const accAt = (s, g, id) => { const x = s.acc[g.id]?.get(id); return x?.v ? x.at : 0; };
const accBy = (s, g, id) => accAt(s, g, id) ? iso(new Date(accAt(s, g, id) + 7 * 864e5)) : "";
const sugNew = (s, g) => !accAt(s, g, me.id);
const sugDueToday = (g, today = iso(new Date())) => { const s = lastState; return !!s && !!accAt(s, g, me.id) && sugOpen(s, g, me.id) && accBy(s, g, me.id) <= isoAdd(today, 2); };
const byLabel = d => new Date(d + "T12:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
function acceptSug(s, g) {
  const by = iso(new Date(Date.now() + 7 * 864e5));
  act("acc", { sg: g.id, v: 1 }, { to: [g.a], title: `${me.name} accepted ${g.m.n}`, body: `Watching it this week (by ${byLabel(by)}).` });
  // One friendly nudge the evening before the week is up, only if it still isn't marked as seen by then (marking it seen cancels it).
  const at = new Date(by + "T18:00"); at.setDate(at.getDate() - 1);
  window.MarqueePush?.send({ to: [me.id], id: `acc_${g.id}_${me.id}`.replace(/[^\w]/g, "").slice(0, 60), at: +at, title: `Still on for ${g.m.n}?`, body: `You said you'd watch ${g.by}'s suggestion this week. Tap Watched? when you have.` });
  M.toast(`Accepted. Watch ${g.m.n} by ${byLabel(by)}.`);
}
const whoLabel = (s, g) => g.to.includes("*") ? "everyone" : sugTo(s, g).map(id => id === me.id ? "you" : s.members.get(id)?.name || "someone").join(", ");

function calEvents(s, mode) {
  const ev = {};
  if (mode === "home") {
    for (const r of Object.keys(s.picks).map(Number).sort((a, b) => a - b)) {
      const m = s.picks[r], d = nightAfter(m.at, s.day);
      ev[ymd(d)] = { k: "past", m, r, d };
    }
  } else {
    for (const mo of Object.values(s.mon)) if (mo.pick?.sc?.d) { const [y, m, d] = mo.pick.sc.d.split("-").map(Number); ev[ymd(new Date(y, m - 1, d, 12))] = { k: "cine", m: mo.pick, d: new Date(y, m - 1, d, 12) }; }
    for (const o of s.outs.values()) if (o.sc?.d && o.ins.size) { const [y, m, d] = o.sc.d.split("-").map(Number); ev[ymd(new Date(y, m - 1, d, 12))] = { k: "cine", m: { ...o.m, sc: o.sc }, o, d: new Date(y, m - 1, d, 12) }; }
  }
  return ev;
}
function calHtml(s, ev, mode) {
  // Five weeks: last week, this week and three ahead. Arrows move four weeks.
  const st = CAL[mode], home = mode === "home";
  const start = new Date(); start.setHours(12, 0, 0, 0); start.setDate(start.getDate() - (start.getDay() + 6) % 7 - 7 + st.off * 28);
  const end = new Date(start); end.setDate(end.getDate() + 34);
  const today = ymd(new Date());
  if (!st.sel) st.sel = today;
  // At home: suggestions to you or from you land on their days (weekly ones repeat until seen).
  const sugBy = {};
  if (home) for (const g of [...sugForMe(s), ...sugMine(s)]) for (const d of sugDays(g, iso(start), iso(end))) (sugBy[d] ||= []).push(g);
  let cells = "";
  for (let i = 0; i < 35; i++) {
    const day = new Date(start); day.setDate(start.getDate() + i);
    const d = day.getDate(), k = ymd(day), di = iso(day), e = ev[k], cls = `${k === today ? " today" : ""}${k === st.sel ? " sel" : ""}`;
    const lbl = d === 1 || i === 0 ? day.toLocaleDateString(undefined, { month: "short" }) + " " + d : d;
    const sg = sugBy[di] || [];
    const nc = home ? sg.length : (calAll ? (cineByDay[di] || []).length : 0) + kpOpening(di).length;
    const cnt = nc ? `<i class="cnt" title="${nc} ${home ? "to watch" : calAll ? "screenings in Ghent" : "new at Kinepolis"}">${nc}</i>` : "";
    const startSg = sg.filter(g => g.d === di); // the poster only on the day it was suggested; reminders after that are just a number
    const th = e ? poster(e.m.p, "w92") : startSg.length ? poster(startSg[0].m.p, "w92") : "";
    if (!th && !nc) { cells += `<button class="cal-d${cls}" data-cal="${k}" aria-label="${esc(nightLabel(day))}"><em>${lbl}</em></button>`; continue; }
    cells += `<button class="cal-d ${e ? "ev " + e.k : startSg.length ? "ev sug" : "cn"}${cls}" data-cal="${k}" aria-label="${esc(nightLabel(day))}"><em>${lbl}</em>${th ? `<span class="th">${th}</span>` : ""}${e?.k === "cine" ? `<i class="tk" title="Cinema night">🎟</i>` : ""}${cnt}</button>`;
  }
  const fmt = d => d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const [sy, sm, sd] = st.sel.split("-").map(Number), selDay = new Date(sy, sm - 1, sd, 12), selIso = iso(selDay), e = ev[st.sel];
  let info = `<b>${esc(nightLabel(selDay))}</b>`;
  if (e?.k === "cine") info += `<span class="cn-line">🎟 <b>Outing:</b> ${esc(e.m.n)} · ${esc(scLabel(e.m.sc))}${e.o ? ` · ${[...e.o.ins.values()].map(esc).join(", ")}` : ""}</span>`;
  if (e?.k === "past") info += `<span>Watched together: ${esc(e.m.n)}${e.m.y ? ` (${esc(e.m.y)})` : ""}</span>`;
  if (home) {
    const sg = sugBy[selIso] || [];
    info += sg.length ? sg.map(g => `<div class="cal-sug" data-open="${esc(key(g.m))}">${poster(g.m.p, "w92")}<span><b>${esc(g.m.n)}</b><small class="hint">${g.a === me.id ? `You → ${esc(whoLabel(s, g))}` : `From ${esc(g.by)}`} · ${g.d === selIso ? "suggested" : "weekly reminder"}</small></span></div>`).join("")
      : `<small class="hint">Nothing to watch this day. Tap a title on the club watchlist to suggest it.</small>`;
  }
  return `<div class="cal-main"><div class="cal-nav"><button class="link" data-cm="-1" aria-label="Earlier weeks">‹</button><b>${fmt(start)} – ${fmt(end)}</b><button class="link" data-cm="1" aria-label="Later weeks">›</button></div>
    <div class="cal">${["M", "T", "W", "T", "F", "S", "S"].map(x => `<span class="cal-h">${x}</span>`).join("")}${cells}</div>
    <div class="cal-key">${home ? `<span><i class="k cnt">2</i>Reminders</span><span><i class="k past"></i>Watched together</span>` : `<span>🎟 Outing</span><span><i class="k cnt">3</i>${calAll ? "Screenings in Ghent" : "New at Kinepolis"}</span><button class="chip${calAll ? " on" : ""}" id="calAll">All Ghent screenings</button>`}</div></div>
    <div class="cal-info">${info}${home ? "" : cineHtml(selIso)}</div>`;
}
function bindCal(s, ev, mode) {
  const box = $(mode === "home" ? "cbCalH" : "cbCal"); if (!box) return;
  const st = CAL[mode];
  const redraw = box._redraw = () => { box.innerHTML = calHtml(s, ev, mode); bindCal(s, ev, mode); };
  box.querySelectorAll("[data-cine]").forEach(b => b.onclick = () => { const off = cineOff(), c = b.dataset.cine; off.has(c) ? off.delete(c) : off.add(c); LS.set("marqueeCinemasOff", [...off]); indexCine(); redraw(); });
  box.querySelectorAll("[data-cn]").forEach(b => b.onclick = () => { const x = JSON.parse(b.dataset.cn); pickTime(x, h => cineNominate({ c: x.c, d: x.d, h, u: x.u }, x.t)); });
  box.querySelectorAll("[data-cm]").forEach(b => b.onclick = () => { st.off += +b.dataset.cm; redraw(); });
  box.querySelector("#calAll")?.addEventListener("click", () => { calAll = !calAll; LS.set("marqueeCalAll2", calAll); redraw(); });
  box.querySelectorAll("[data-cal]").forEach(b => b.onclick = () => { st.sel = b.dataset.cal; kpAll = false; redraw(); });
  box.querySelectorAll("[data-open]").forEach(b => b.onclick = () => openTitleByKey(s, b.dataset.open));
  box.querySelector("#kpMore")?.addEventListener("click", () => { kpAll = true; redraw(); });
}

// ---------- cinema night (monthly) ----------
let cineNominate = () => {};
function pickTime(x, done) {
  const times = x.h && x.h.length ? x.h : [""];
  if (times.length === 1) { done(times[0]); return; }
  const bg = el(`<div class="sheet-bg"><div class="sheet" role="dialog" aria-label="Pick a time"><h3>${esc(x.t)}</h3><p class="hint">${esc(x.c)} · which screening?</p>
    <div class="row-btns" style="display:flex;gap:8px;flex-wrap:wrap">${times.map(h => `<button data-h="${esc(h)}">${esc(h)}</button>`).join("")}</div><button id="ptCancel">Cancel</button></div></div>`);
  document.body.appendChild(bg);
  bg.addEventListener("click", e => { const b = e.target.closest("[data-h]"); if (b) { bg.remove(); done(b.dataset.h); } else if (e.target === bg || e.target.id === "ptCancel") bg.remove(); });
}
// Match a cinema title to TMDB so the vote shows a poster; fall back to the bare title.
async function matchMovie(title) {
  const yr = (title.match(/\((\d{4})\)\s*$/) || [])[1], q = title.replace(/\s*\(\d{4}\)\s*$/, "");
  try {
    const d = await M.tm("/search/movie", yr ? { query: q, year: yr } : { query: q });
    const x = (d.results || [])[0];
    if (x) return { t: "movie", i: x.id, n: x.title, y: (x.release_date || "").slice(0, 4), p: x.poster_path || "" };
  } catch {}
  let h = 0; for (const ch of q) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return { t: "movie", i: -Math.abs(h) || -1, n: q, y: yr || "", p: "" };
}
const KP_URL = "https://kinepolis.be/nl/bioscopen/kinepolis-gent";
function openScreenings(onPick, initial = "") {
  const soon = new Date(); soon.setDate(soon.getDate() + 60);
  const today = iso(new Date()), until = iso(soon);
  const films = {};
  for (const x of cine?.screenings || []) {
    if (x.d < today || x.d > until) continue;
    const f = (films[x.c + "|" + x.t] ||= { c: x.c, t: x.t, u: x.u, shows: [] }); f.shows.push(x);
  }
  const list = Object.values(films).sort((a, b) => a.t.localeCompare(b.t));
  const bg = el(`<div class="sheet-bg"><div class="sheet" role="dialog" aria-label="Suggest a screening"><h3>Suggest a screening</h3>
    ${cine ? `<input type="search" id="scQ" placeholder="Filter films or cinemas" autocomplete="off">` : `<p class="hint">Ghent listings aren't loaded right now.</p>`}
    <div id="scNow"></div>
    <div class="sc-list" id="scList"></div>
    <button id="scAny">Or search any movie</button><button id="scCancel">Cancel</button></div></div>`);
  document.body.appendChild(bg);
  const box = bg.querySelector("#scList"); let open = null;
  const draw = () => {
    const q = (bg.querySelector("#scQ")?.value || "").toLowerCase();
    const shown = list.filter(f => !q || f.t.toLowerCase().includes(q) || f.c.toLowerCase().includes(q)).slice(0, 60);
    box.innerHTML = shown.length ? shown.map((f, i) => `<div class="sc-f"><button class="sc-t" data-f="${list.indexOf(f)}"><b>${esc(f.t)}</b><small>${esc(f.c)} · ${f.shows.length} screening${f.shows.length === 1 ? "" : "s"}</small></button>
      ${open === list.indexOf(f) ? `<div class="sc-times">${f.shows.slice(0, 24).map((x, j) => `<button class="chip" data-s="${j}">${esc(scLabel({ c: "", d: x.d, h: x.h }).replace(/^ · /, ""))}</button>`).join("")}</div>` : ""}</div>`).join("")
      : `<p class="hint">${cine ? "Nothing matches." : ""}</p>`;
  };
  if (initial && bg.querySelector("#scQ")) { bg.querySelector("#scQ").value = initial; const hit = list.filter(f => f.t === initial); if (hit.length === 1) open = list.indexOf(hit[0]); }
  draw();
  // Kinepolis Gent blocks automated reading of its programme, so instead list what TMDB says is in Belgian cinemas now
  // (wide releases all play at Kinepolis). The date and time get set after the vote.
  let now = [];
  const drawNow = () => {
    const q = (bg.querySelector("#scQ")?.value || "").toLowerCase(), shown = now.filter(m => !q || m.n.toLowerCase().includes(q) || "kinepolis".includes(q));
    bg.querySelector("#scNow").innerHTML = shown.length ? `<h4 class="wl-sec">Now in cinemas · Kinepolis Gent</h4><div class="sc-now">${shown.map((m, i) => `<button data-now="${now.indexOf(m)}">${poster(m.p, "w92")}<small>${esc(m.n)}</small></button>`).join("")}</div>
      <a class="link" href="${KP_URL}" target="_blank" rel="noopener">Kinepolis Gent times ↗</a>` : "";
  };
  kpList("/movie/now_playing").then(l => { now = l.map(f => f.m); drawNow(); }).catch(() => {});
  bg.querySelector("#scQ")?.addEventListener("input", () => { draw(); drawNow(); });
  bg.addEventListener("click", e => {
    if (e.target === bg || e.target.id === "scCancel") { bg.remove(); return; }
    if (e.target.id === "scAny") { bg.remove(); onPick(null); return; }
    const nb = e.target.closest("[data-now]"); if (nb) { const m = now[+nb.dataset.now]; bg.remove(); onPick({ c: "Kinepolis Gent", d: "", h: "", u: KP_URL }, m.n, m); return; }
    const t = e.target.closest("[data-f]"); if (t) { open = open === +t.dataset.f ? null : +t.dataset.f; draw(); return; }
    const sb = e.target.closest("[data-s]");
    if (sb && open != null) { const f = list[open], x = f.shows[+sb.dataset.s]; bg.remove(); onPick({ c: x.c, d: x.d, h: x.h, u: x.u }, f.t); }
  });
  setTimeout(() => bg.querySelector("#scQ")?.focus(), 50);
}
// Pick or change the outing's date: one of the film's Ghent screenings, or any date, time and place.
function openDate(pick, done) {
  const k = seenKey(pick.n), today = iso(new Date());
  const shows = (cine?.screenings || []).filter(x => x.d >= today && seenKey(x.t) === k).slice(0, 30);
  const cur = pick.sc || {};
  const bg = el(`<div class="sheet-bg"><div class="sheet" role="dialog" aria-label="Set the date"><h3>When do we go to ${esc(pick.n)}?</h3>
    ${shows.length ? `<p class="hint">Screenings in Ghent:</p><div class="sc-times">${shows.map((x, i) => `<button class="chip" data-i="${i}">${esc(scLabel(x))}</button>`).join("")}</div><p class="hint">Or pick your own:</p>` : ""}
    <div style="display:flex;gap:8px"><label style="flex:1">Date <input type="date" id="odD" value="${esc(cur.d || "")}" min="${today}"></label><label style="flex:1">Time <input type="time" id="odH" value="${esc(cur.h || "20:00")}"></label></div>
    <label>Where <input type="text" id="odC" maxlength="40" value="${esc(cur.c || "")}" placeholder="Cinema"></label>
    <button class="primary" id="odGo">Save date</button><button id="odCancel">Cancel</button></div></div>`);
  document.body.appendChild(bg);
  bg.addEventListener("click", e => {
    if (e.target === bg || e.target.id === "odCancel") { bg.remove(); return; }
    const c = e.target.closest("[data-i]"); if (c) { const x = shows[+c.dataset.i]; bg.remove(); done({ c: x.c, d: x.d, h: x.h, u: x.u }); return; }
    if (e.target.id === "odGo") {
      const d = bg.querySelector("#odD").value; if (!d) { M.toast("Pick a date first."); return; }
      bg.remove(); done({ c: bg.querySelector("#odC").value.trim(), d, h: bg.querySelector("#odH").value, u: cur.u || "" });
    }
  });
}
// Upcoming outings: no date yet, or a date from today on. Soonest first, undated last.
function outings(s) {
  const today = iso(new Date());
  return [...s.outs.values()].filter(o => !o.sc?.d || o.sc.d >= today).sort((a, b) => (a.sc?.d || "9999").localeCompare(b.sc?.d || "9999") || b.at - a.at);
}
// Day-before reminder: queued with a send time; the same id per outing, so a new date replaces the old reminder.
function scheduleOutingReminder(s, o, plus) {
  if (!o.sc?.d || !window.MarqueePush) return;
  const at = new Date(o.sc.d + "T18:00"); at.setDate(at.getDate() - 1);
  if (at.getTime() < now()) return;
  const to = [...new Set([...o.ins.keys(), ...(plus ? [plus] : []), me.id])].filter(id => !id.startsWith("demo_"));
  let h = 0; for (const ch of active().id + o.ok) h = (h * 31 + ch.charCodeAt(0)) | 0;
  window.MarqueePush.send({ id: "rem_" + (h >>> 0).toString(36), to, url: "./?view=cine", at: at.getTime(), title: `Tomorrow: ${o.m.n}`, body: `${scLabel(o.sc)}${o.spot ? ` · after: ${o.spot}` : ""}. Got your ticket?` });
}
function outingIcs(o) {
  const d = o.sc.d.replace(/-/g, ""), [hh, mm] = (o.sc.h || "20:00").split(":"), stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const clean = t => String(t).replace(/[,;\n]/g, " ");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Marquee//Movie club//EN", "BEGIN:VEVENT", `UID:${encodeURIComponent(o.ok).slice(0, 60)}@marquee`, `DTSTAMP:${stamp}`,
    `DTSTART:${d}T${hh}${mm}00`, `DURATION:PT3H`, `SUMMARY:${clean(o.m.n)} at ${clean(o.sc.c || "the cinema")}`, `LOCATION:${clean(o.sc.c || "")}`, `DESCRIPTION:${clean([...o.ins.values()].join(", "))}${o.spot ? clean(" · after: " + o.spot) : ""}`,
    "BEGIN:VALARM", "TRIGGER:-P1D", "ACTION:DISPLAY", `DESCRIPTION:Tomorrow: ${clean(o.m.n)}`, "END:VALARM", "END:VEVENT", "END:VCALENDAR"];
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([lines.join("\r\n")], { type: "text/calendar" })); a.download = "outing.ics";
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
function cinemaCard(s, members) {
  const list = outings(s);
  const row = o => {
    const mine = o.ins.has(me.id), going = [...o.ins.entries()];
    return `<div class="out-i${mine ? " in" : ""}">${poster(o.m.p, "w92")}<div class="body">
      <b>${esc(o.m.n)}${o.m.y ? ` <small>${esc(o.m.y)}</small>` : ""}</b>
      <span class="ticket-line">${o.sc?.d ? `🎟 ${esc(scLabel(o.sc))}` : `📅 No date yet${o.sc?.c ? ` · ${esc(o.sc.c)}` : ""}`}</span>
      ${o.spot ? `<span class="spot">🍻 After: <b>${esc(o.spot)}</b></span>` : ""}
      <span class="whos">${going.map(([id, n]) => `<span class="who ok">✓ ${esc(id === me.id ? "You" : n)}</span>`).join("")}</span>
      <small class="hint">Suggested by ${esc(o.a === me.id ? "you" : o.by)}${o.sc?.u ? ` · <a class="link" href="${esc(o.sc.u)}" target="_blank" rel="noopener">Tickets</a>` : ""} · ${imdbLink(o.m)}${o.a === me.id ? ` · <button class="link" data-odrop="${esc(o.ok)}">remove</button>` : ""}</small>
      <div class="acts"><button class="${mine ? "vote on" : "primary"}" data-in="${esc(o.ok)}">${mine ? "✓ I'm in" : "I'm in"}</button>
        ${mine ? `<button data-odate="${esc(o.ok)}">${o.sc?.d ? "Change date" : "Pick a date"}</button><button data-ospot="${esc(o.ok)}">${o.spot ? "Change spot" : "🍻 Drinks/dinner"}</button>` : ""}
        ${mine && o.sc?.d ? `<button data-oics="${esc(o.ok)}" aria-label="Add to my calendar">📅</button>` : ""}</div>
    </div></div>`;
  };
  return `<div class="cinema">
    ${list.map(row).join("") || `<p class="hint">Suggest a film in a Ghent cinema. Friends tap "I'm in", then you pick a date together.</p>`}
    <button class="${list.length ? "" : "primary"}" id="cnSuggest">🎟 Suggest an outing</button>
  </div>`;
}
function bindCinema(s) {
  const nom = async (sc, title, m) => {
    m ||= await matchMovie(title);
    const x = { m, sc };
    if (s.outs.has(ckey(x))) { M.toast("That outing is already planned."); return; }
    await act("nom", { tr: "m", r: monthOf(new Date()), m, sc }, { view: "cine", title: `${me.name} wants to see ${m.n}`, body: `${sc ? scLabel(sc) + ". " : ""}Tap "I'm in" if you want to come.` });
    M.toast(`${m.n} is up. Friends can tap "I'm in".`);
  };
  cineNominate = (sc, title) => nom(sc, title);
  $("cnSuggest")?.addEventListener("click", () => openScreenings((sc, title, m) => sc ? nom(sc, title, m) : openSearch("Suggest a film to go see", m => nom(null, m.n, m))));
  cineEl.querySelectorAll("[data-in]").forEach(b => b.onclick = () => {
    const o = s.outs.get(b.dataset.in); if (!o) return; const v = o.ins.has(me.id) ? 0 : 1;
    if (v && o.sc?.d) scheduleOutingReminder(s, o, me.id);
    act("in", { ok: o.ok, v }, v ? { view: "cine", title: `${me.name} is in for ${o.m.n}`, body: o.sc?.d ? scLabel(o.sc) : "Pick a date in the club." } : null);
  });
  cineEl.querySelectorAll("[data-odate]").forEach(b => b.onclick = () => {
    const o = s.outs.get(b.dataset.odate); if (!o) return;
    openDate({ ...o.m, sc: o.sc }, sc => (scheduleOutingReminder(s, { ...o, sc }), act("odate", { ok: o.ok, sc }, { view: "cine", title: `${o.m.n}: we're going ${scLabel(sc)}`, body: `${[...o.ins.values()].join(", ")} so far. Tap "I'm in" to join.` })));
  });
  cineEl.querySelectorAll("[data-ospot]").forEach(b => b.onclick = () => {
    const o = s.outs.get(b.dataset.ospot); if (!o) return;
    const x = prompt("Drinks or dinner after? Where:", o.spot || ""); if (x == null) return;
    act("ospot", { ok: o.ok, x: x.trim() }, x.trim() ? { to: [...o.ins.keys()], title: `${o.m.n}: after, ${x.trim()}`, body: `${me.name} suggests ${x.trim()} after the film.` } : null);
  });
  cineEl.querySelectorAll("[data-oics]").forEach(b => b.onclick = () => { const o = s.outs.get(b.dataset.oics); if (o) outingIcs(o); });
  cineEl.querySelectorAll("[data-odrop]").forEach(b => b.onclick = () => { const o = s.outs.get(b.dataset.odrop); if (o && confirm(`Remove ${o.m.n}?`)) act("drop", { tr: "m", r: monthOf(new Date()), m: o.m, sc: o.sc }); });
}

// ---------- club watchlist ----------
let wlAll = false, wlQs = {}, wlMsg = "", wlType = "all", wlView = "common", wlNobody = false;
// Watchlist: "mine" (what I added) or "club" (what the friends I pick added). wlFriends empty = all friends.
let wlMode = LS.get("marqueeWlMode", "club"), wlFriends = new Set(LS.get("marqueeWlFriends", [])), wlUnseen = LS.get("marqueeWlUnseen", true);
function parseCsv(text) {
  const rows = []; let row = [], f = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
    else if (ch === '"') q = true; else if (ch === ",") { row.push(f); f = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(f); rows.push(row); row = []; f = ""; }
    else f += ch;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows;
}
function wlCard(s, cands, wlMode) {
  const wlQ = wlQs[wlMode] || ""; // each list has its own search box
  const nominated = new Map(cands.map(x => [key(x.m), x]));
  const seenBy = t => [...(s.saw[seenKey(t)] || new Map()).values()].filter(x => x.v).length;
  const picked = new Set(Object.values(s.picks).map(key)); // already watched as a club: lives in History now
  const base = [...s.wl.values()].filter(w => !picked.has(key(w.m))).map(w => ({ ...w, nom: nominated.get(key(w.m)) }));
  // To watch list: what I added and haven't watched yet. Club watchlist: what the friends I pick added that I haven't watched.
  // Watching something takes it off both (it lives in My watched). Recommending is a separate, explicit step.
  // Watched means this exact title: a 2002 film you rated doesn't hide a 2026 series with the same name.
  const iSaw = w => { const x = s.saw[seenKey(w.m.n)]?.get(me.id); return !!x?.v && (!x.m || key(x.m) === key(w.m)) && !((w.addAt?.get(me.id) || 0) > (x.at || 0)); };
  const friends = [...s.members.entries()].filter(([id]) => id !== me.id).map(([id, m]) => ({ id, name: m.name, n: base.filter(w => w.adders.has(id) && !iSaw(w)).length })).filter(p => p.n);
  for (const id of [...wlFriends]) if (!friends.some(f => f.id === id)) wlFriends.delete(id);
  const sel = wlFriends.size ? [...wlFriends] : friends.map(f => f.id);
  const mineAll = base.filter(w => w.adders.has(me.id) && !iSaw(w)), mineN = mineAll.length;
  // Everything you logged as watched in Marquee also shows on your Personal watchlist, with a ✓, in a Watched section at the bottom (imports stay out).
  const mineDone = []; // watched titles live in Seen before
  let items = wlMode === "mine" ? mineAll : base.filter(w => !iSaw(w) && sel.some(id => w.adders.has(id)));
  // Date added: when you put it on your list (Club list: the newest add by a friend you picked).
  const addedAt = w => wlMode === "mine" ? w.addT?.get(me.id) || w.at || 0 : Math.max(0, ...sel.map(id => w.addT?.get(id) || 0)) || w.at || 0;
  const nTv = items.filter(w => isTv(w.m)).length, mixed = nTv && nTv < items.length;
  const svc = myServices(), onMine = w => (provCache[key(w.m)]?.l || []).some(p => svc.has(p.id));
  const preStream = items;
  const nobodySaw = m => ![...(s.saw[seenKey(m.n)]?.values() || [])].some(x => x.v);
  items = items.filter(w => (!wlQ || w.m.n.toLowerCase().includes(wlQ)) && (!mixed || wlType === "all" || (wlType === "tv") === isTv(w.m)) && (wlMode === "club" || !wlStream || onMine(w)) && (!wlNobody || nobodySaw(w.m)))
    .sort(wlSort === "az" ? (a, b) => a.m.n.localeCompare(b.m.n)
      : wlSort === "year" ? (a, b) => (+b.m.y || 0) - (+a.m.y || 0) || a.m.n.localeCompare(b.m.n)
      : wlSort === "rate" ? (a, b) => rateOf(b.m) - rateOf(a.m) || a.m.n.localeCompare(b.m.n)
      : wlSort === "added" ? (a, b) => addedAt(b) - addedAt(a) || a.m.n.localeCompare(b.m.n)
      : (a, b) => b.adders.size - a.adders.size || b.at - a.at);
  const done = mineDone.filter(w => (!wlQ || w.m.n.toLowerCase().includes(wlQ)) && (!mixed || wlType === "all" || (wlType === "tv") === isTv(w.m)) && !wlNobody);
  const grouped = wlSort === "genre" && items.length >= 8 && !wlQ;
  const shown = items;
  if ([...items, ...done].some(w => !(key(w.m) in rateCache))) setTimeout(() => fillGenres([...items, ...done]), 0);
  { const need = wlStream ? preStream : shown; setTimeout(() => fillProv(need), 0); } // streaming logos show on every tile automatically
  const sawBy = (t, id) => !!s.saw[seenKey(t)]?.get(id)?.v;
  const fchip = (id, l, n, on) => `<button class="chip${on ? " on" : ""}" data-wlf="${esc(id)}">${esc(l)}${n != null ? ` <i>${n}</i>` : ""}</button>`;
  // Netflix-style poster tiles: tap opens the title sheet (Watched?, remove, suggest, where to stream live there).
  const tile = w => {
    const l = provCache[key(w.m)]?.l || [], mp = l.filter(p => svc.has(p.id)), pv = (mp.length ? mp : l)[0];
    const mx = s.saw[seenKey(w.m.n)]?.get(me.id), mineSaw = !!mx?.v && (!mx.m || key(mx.m) === key(w.m)), n = w.adders.size;
    return `<button class="wl-tile" data-open="${esc(key(w.m))}" aria-label="${esc(w.m.n)}">${poster(w.m.p, "w342")}
      ${pv ? `<img class="tile-prov${mp.length ? " mine" : ""}" src="${M.IMG}w92${esc(pv.logo)}" alt="${esc(pv.n)}" title="${esc(pv.n)}">` : ""}
      ${mineSaw ? `<i class="tile-ok" aria-label="You watched it">✓</i>` : ""}${isTv(w.m) ? `<i class="tile-tv">Series</i>` : ""}
      <span class="tile-t"><b>${esc(w.m.n)}</b>${(() => { const r = rateOf(w.m), bits = [w.m.y || "", n > 1 ? `${n} want it` : ""].filter(Boolean); return bits.length || r ? `<small>${esc(bits.join(" · "))}${r ? rateRing(r) : ""}</small>` : ""; })()}</span></button>`;
  };
  // Long lists become Netflix-style rows per genre (each title in its main genre); short ones stay a simple grid.
  const tiles = list => {
    if (!grouped) return `<div class="wl-grid">${list.map(tile).join("")}</div>`;
    if (list.some(w => !genreCache[key(w.m)])) setTimeout(() => fillGenres(list), 0);
    const groups = {}; for (const w of list) (groups[genreOf(w.m) || "Loading…"] ||= []).push(w);
    return Object.entries(groups).sort((a, b) => (a[0] === "Loading…") - (b[0] === "Loading…") || (a[0] === "Other") - (b[0] === "Other") || b[1].length - a[1].length)
      .map(([g, ws]) => `<details class="g-sec" data-g="${esc(g)}"${genreShut.has(g) ? "" : " open"}><summary>${esc(g)} <i>${ws.length}</i></summary><div class="wl-grid">${ws.map(tile).join("")}</div></details>`).join("");
  };
  return `<div id="wlCard">
    ${wlMode === "mine" ? `<p class="hint" id="wlStatus"${wlMsg ? "" : " hidden"}>${esc(wlMsg)}</p>` : ""}
    ${wlMode === "club" && location.hash === "#demo" && !hasDemo(active().id) ? `<button class="fy-demo" data-demo="1">Add test friends</button>` : ""}
    ${wlMode === "old" ? seenBeforeCard(s) : `
    ${wlMode === "club" && !friends.length ? `<p class="hint">Your friends' watchlists show up here once they add films. Invite them with the Invite button above.</p>` : ""}
    <div class="wl-tools">${wlMode === "club" && friends.length ? `<div class="wl-views wl-fr">${fchip("*", "All friends", null, !wlFriends.size)}${friends.map(f => fchip(f.id, f.name, f.n, wlFriends.has(f.id))).join("")}<button class="primary" id="cwAdd">+ Add</button></div>` : ""}
      ${items.length > 12 || wlQ ? `<input type="search" id="wlQ_${wlMode}" class="wlQ" placeholder="Search" value="${esc(wlQ)}" autocomplete="off">` : ""}${wlMode === "club" && friends.length ? "" : `<button class="primary" id="cwAdd">+ Add</button>`}</div>
    ${preStream.length > 1 ? (() => { const seg = (attr, opts, cur) => `<div class="seg">${opts.map(([k, l]) => `<button class="${k === cur ? "on" : ""}" ${attr}="${k}">${l}</button>`).join("")}</div>`;
      const tog = (attr, on, l) => `<button class="tog${on ? " on" : ""}" ${attr}="${on ? 0 : 1}" aria-pressed="${on}">${l}</button>`;
      return `<div class="wl-filt"><div class="wl-frow">${seg("data-so", [["added", "Added"], ["az", "A–Z"], ["genre", "Genre"], ["year", "Year"], ["rate", "★ Rating"]], wlSort)}${mixed ? seg("data-ty", [["all", "All"], ["movie", "Films"], ["tv", "Series"]], wlType) : ""}</div>
        <div class="wl-frow">${wlMode === "mine" ? tog("data-st", wlStream, "📺 My services" + (wlStream && provBusy ? "…" : "")) : ""}${tog("data-nb", wlNobody, "👀 Nobody's seen")}</div></div>`; })() : ""}
    ${tiles(shown)}${done.length ? `<details class="g-sec wl-done" data-g="__watched"${genreShut.has("__watched") ? "" : " open"}><summary>✓ Watched <i>${done.length}</i></summary><div class="wl-grid">${done.map(tile).join("")}</div></details>` : ""}${items.length || done.length ? "" : `<p class="hint">${!base.length ? "Empty for now. Tap + Add to bring in your IMDb or Letterboxd watchlist." : wlMode === "mine" ? "Nothing left to watch on your list. Tap + Add to add more." : "Nothing here that you haven't watched yet."}</p>`}
`}
  </div>`;
}
const myWlCount = s => { const picked = new Set(Object.values(s.picks).map(key)); return [...s.wl.values()].filter(w => !picked.has(key(w.m)) && w.adders.has(me.id) && !(x => !!x?.v && (!x.m || key(x.m) === key(w.m)) && !((w.addAt?.get(me.id) || 0) > (x.at || 0)))(s.saw[seenKey(w.m.n)]?.get(me.id))).length; };
const pulpPick = (opts, cur, attr, three) => `<div class="wl-pick${three ? " three" : ""}" role="tablist">${opts.map(([k, ch, l, dot], i) => `<button class="pulp-head${i ? " alt" : ""}${cur === k ? " on" : ""}${dot ? " dot" : ""}" ${attr}="${k}" role="tab" aria-selected="${cur === k}"><span class="chapter">${ch}</span><span class="bang">${l}</span></button>`).join("")}</div>`;
let clubPane = LS.get("marqueeClubPane", "club"), lsPane = LS.get("marqueeLsPane", "mine"); if (lsPane === "old") lsPane = "mine";
// ---------- Popular: this week's most popular films (TMDB trending), with who in the club wants or saw them ----------
let popList = null, popBusy = false, popType = "movie", popSort = "pop";
async function loadPop() {
  if (popBusy) return; popBusy = true;
  try {
    const pages = await Promise.all([1, 2].map(page => M.tm(`/trending/${popType}/week`, { page })));
    popList = pages.flatMap(d => d.results || []).filter(x => x.poster_path).map(x => ({ t: popType, i: x.id, n: x.title || x.name, y: (x.release_date || x.first_air_date || "").slice(0, 4), p: x.poster_path || "", _r: x.vote_count >= 5 ? +(+x.vote_average || 0).toFixed(1) : 0 })).filter((m, i, a) => a.findIndex(o => o.i === m.i) === i);
    for (const m of popList) { rateCache[key(m)] = m._r; delete m._r; }
  } catch { popList = popList || []; }
  popBusy = false; render();
}
function popHtml(s) {
  const tile = w => { const r = rateOf(w.m), x = s.saw[seenKey(w.m.n)]?.get(me.id), saw = !!x?.v && (!x.m || key(x.m) === key(w.m)), n = w.adders.size;
    return `<button class="wl-tile" data-open="${esc(key(w.m))}" aria-label="${esc(w.m.n)}">${poster(w.m.p, "w342")}${saw ? `<i class="tile-ok" aria-label="You watched it">✓</i>` : ""}${isTv(w.m) ? `<i class="tile-tv">Series</i>` : ""}<span class="tile-t"><b>${esc(w.m.n)}</b><small>${esc([w.m.y, n ? `${n} want it` : ""].filter(Boolean).join(" · "))}${r ? rateRing(r) : ""}</small></span></button>`; };
  if (!popList) { loadPop(); return `<p class="hint">Loading what's popular this week…</p>`; }
  if (!popList.length) return `<p class="hint">Couldn't load the popular list. Check your connection.</p>`;
  const sg = (attr, opts, cur) => `<div class="seg">${opts.map(([k, l]) => `<button class="${k === cur ? "on" : ""}" ${attr}="${k}">${l}</button>`).join("")}</div>`;
  const seg = `<div class="wl-filt"><div class="wl-frow">${sg("data-pops", [["pop", "Most popular"], ["rate", "★ Rating"]], popSort)}${sg("data-popt", [["movie", "Films"], ["tv", "Series"]], popType)}</div></div>`;
  const ranked = popList.map((m, i) => ({ m, i })); if (popSort === "rate") ranked.sort((a, b) => rateOf(b.m) - rateOf(a.m));
  return `${seg}<div class="wl-grid pop-grid">${ranked.map(({ m }, i) => { const w = s.wl.get(key(m)) || { m, adders: new Map() }; return tile({ ...w, m: w.m || m }).replace('<button class="wl-tile"', `<button class="wl-tile" data-rank="${i + 1}"`); }).join("")}</div>`;
}
// ---------- genres for the watchlist rows (cached on this device) ----------
const genreCache = LS.get("marqueeGenres", {});
const rateCache = LS.get("marqueeRates", {}); // TMDB score per title, for the Rating sort and badges
const rateOf = m => rateCache[key(m)] || 0;
// Score badge: a comic stamp with a ring that fills to the score, green / yellow / grey by how good it is.
const rateCol = r => r >= 7.5 ? "#2fbf5b" : r >= 6 ? "#ffd400" : "#9a94a6";
const rateRing = (r, big) => `<span class="rring${big ? " big" : ""}" style="--p:${Math.round(r * 10)};--c:${rateCol(r)}" aria-label="Rated ${r.toFixed(1)} out of 10"><b>${r.toFixed(1)}</b></span>`;
const genreShut = new Set(); // genre sections you folded (all open by default)
let cinePane = "cal", mwPane = "list", fyAuto = false, genreBusy = false, wlSort = LS.get("marqueeWlSort2", "az");
async function fillGenres(items) {
  if (genreBusy) return;
  const work = items.filter(w => !genreCache[key(w.m)] || !(key(w.m) in rateCache)).slice(0, 400); if (!work.length) return;
  genreBusy = true;
  await Promise.all([1, 2, 3, 4].map(async () => { while (work.length) { const w = work.shift(); try { const j = await M.tm(`/${w.m.t}/${w.m.i}`); genreCache[key(w.m)] = (j.genres || []).map(g => g.name).slice(0, 3); rateCache[key(w.m)] = j.vote_count >= 5 ? +(+j.vote_average || 0).toFixed(1) : 0; if (!genreCache[key(w.m)].length) genreCache[key(w.m)] = ["Other"]; } catch {} } }));
  try { LS.set("marqueeGenres", genreCache); LS.set("marqueeRates", rateCache); } catch {}
  genreBusy = false; render();
}
const genreOf = m => (genreCache[key(m)] || [])[0]?.replace(/^Sci-Fi & Fantasy$/, "Science Fiction").replace(/^Action & Adventure$/, "Action") || "";
// ---------- general info for the title sheet (genres, length, rating, people, plot, trailer) ----------
const infoCache = {};
async function titleInfo(m) {
  const k = key(m); if (infoCache[k]) return infoCache[k];
  try {
    const j = await M.tm(`/${m.t}/${m.i}`, { append_to_response: "credits,videos" });
    const crew = j.credits?.crew || [];
    const by = m.t === "tv" ? (j.created_by || []).map(x => x.name).slice(0, 2).join(" & ") : crew.filter(x => x.job === "Director").map(x => x.name).slice(0, 2).join(" & ");
    const len = m.t === "tv" ? [j.number_of_seasons ? `${j.number_of_seasons} season${j.number_of_seasons === 1 ? "" : "s"}` : "", j.status === "Ended" ? "ended" : j.in_production ? "still running" : ""].filter(Boolean).join(", ")
      : j.runtime ? `${Math.floor(j.runtime / 60)}h ${String(j.runtime % 60).padStart(2, "0")}m` : "";
    const yt = (j.videos?.results || []).filter(v => v.site === "YouTube"), tr = yt.find(v => v.type === "Trailer" && v.official) || yt.find(v => v.type === "Trailer") || yt[0];
    return (infoCache[k] = { genres: (j.genres || []).map(g => g.name).slice(0, 3).join(", "), len, rate: j.vote_count && j.vote_average ? j.vote_average.toFixed(1) : "", votes: j.vote_count || 0,
      by, cast: (j.credits?.cast || []).slice(0, 4).map(x => x.name).join(", "), plot: j.overview || "", trailer: tr?.key || "" });
  } catch { return null; }
}
// ---------- where to stream (Belgium) ----------
const PROV_TTL = 3 * 864e5;
let provCache = LS.get("marqueeProv", {});
const myServices = () => new Set(LS.get("marqueeMyServices", []));
async function getProv(m) {
  const k = key(m), c = provCache[k];
  if (c && now() - c.t < PROV_TTL) return c;
  const j = await M.tm(`/${m.t}/${m.i}/watch/providers`), be = j.results?.BE || {};
  const l = [...(be.flatrate || []), ...(be.free || []), ...(be.ads || [])].filter((x, i, a) => a.findIndex(y => y.provider_id === x.provider_id) === i).map(x => ({ id: x.provider_id, n: x.provider_name, logo: x.logo_path }));
  provCache[k] = { t: now(), l, u: be.link || "" };
  const keys = Object.keys(provCache); if (keys.length > 400) for (const x of keys.sort((a, b) => provCache[a].t - provCache[b].t).slice(0, 100)) delete provCache[x];
  LS.set("marqueeProv", provCache);
  return provCache[k];
}
const provLogos = (l, mine) => l.map(p => `<img class="prov${mine?.has(p.id) ? " mine" : ""}" src="${M.IMG}w92${esc(p.logo)}" alt="${esc(p.n)}" title="${esc(p.n)}">`).join("");
let allServices = null;
async function loadServices() {
  if (allServices) return allServices;
  const [a, b] = await Promise.all(["movie", "tv"].map(t => M.tm(`/watch/providers/${t}`, { watch_region: "BE" }).catch(() => ({ results: [] }))));
  const map = new Map();
  for (const x of [...(a.results || []), ...(b.results || [])]) if (!map.has(x.provider_id)) map.set(x.provider_id, { id: x.provider_id, n: x.provider_name, logo: x.logo_path, pr: x.display_priorities?.BE ?? x.display_priority ?? 99 });
  return (allServices = [...map.values()].sort((x, y) => x.pr - y.pr).slice(0, 24));
}
async function openServices(done) {
  const bg = el(`<div class="sheet-bg"><div class="sheet" role="dialog" aria-label="My streaming services"><h3>My streaming services</h3><p class="hint">Pick what you pay for. Titles on these get marked, and you can filter the watchlist on them.</p><div class="svc-grid"><p class="hint">Loading…</p></div><button class="primary" id="svcDone">Done</button></div></div>`);
  document.body.appendChild(bg);
  const mine = myServices(), grid = bg.querySelector(".svc-grid");
  const list = await loadServices();
  grid.innerHTML = list.map(p => `<button class="svc${mine.has(p.id) ? " on" : ""}" data-svc="${p.id}"><img src="${M.IMG}w92${esc(p.logo)}" alt=""><span>${esc(p.n)}</span></button>`).join("") || `<p class="hint">Couldn't load the services. Try again later.</p>`;
  grid.querySelectorAll("[data-svc]").forEach(b => b.onclick = () => { const id = +b.dataset.svc; mine.has(id) ? mine.delete(id) : mine.add(id); b.classList.toggle("on", mine.has(id)); });
  const close = () => { LS.set("marqueeMyServices", [...mine]); bg.remove(); done?.(); };
  bg.querySelector("#svcDone").onclick = close;
  bg.addEventListener("click", e => { if (e.target === bg) close(); });
}
// Settings: streaming services and notifications live there.
function leaveClub(id) {
  LS.set("marqueeClubsGone", [...new Set([...LS.get("marqueeClubsGone", []), id])]);
  LS.set("marqueeClubs", LS.get("marqueeClubs", []).filter(x => x.id !== id)); try { localStorage.removeItem(evKey(id)); } catch {}
  delete store[id]; if (activeId === id) { activeId = clubs()[0]?.id || null; LS.set("marqueeClubActive", activeId); } live(); render();
}
function renderSettingsExtras() {
  const st = $("setStream"), pu = $("setPush"), cl = $("setClubs");
  // Version line at the bottom of Settings, so a screenshot shows which version a device runs.
  if (!$("appVer")) { const v = document.createElement("p"); v.id = "appVer"; v.className = "hint"; v.style.textAlign = "center"; $("setClubs")?.parentElement.appendChild(v); fetch("sw.js", { cache: "no-cache" }).then(r => r.text()).then(t => { v.textContent = "Marquee " + ((t.match(/marquee-(v\d+)/) || [])[1] || ""); }).catch(() => {}); }
  if (cl) {
    const list = clubs();
    cl.innerHTML = `<b>My clubs</b>${list.length ? list.map(c => { const s = derive(c.id), n = s.members.size, here = c.id === active()?.id;
      return `<div class="club-row"><div><b>${esc(s.name || c.name)}</b><small class="hint">${n} member${n === 1 ? "" : "s"}${here ? " · open now" : ""}</small></div>${here ? "" : `<button data-copen="${esc(c.id)}">Open</button>`}<button class="link danger" data-cleave="${esc(c.id)}">Leave</button></div>`; }).join("") : `<p class="hint">You're not in a club yet.</p>`}
      <button id="setNewClub">Start or join a club</button>`;
    cl.querySelectorAll("[data-copen]").forEach(b => b.onclick = () => { activeId = b.dataset.copen; LS.set("marqueeClubActive", activeId); live(); render(); M.setView("club"); });
    cl.querySelectorAll("[data-cleave]").forEach(b => b.onclick = () => { const c = clubs().find(x => x.id === b.dataset.cleave); if (!c || !confirm(`Leave ${derive(c.id).name || c.name}? It's removed from all your devices. You can rejoin with an invite link.`)) return; leaveClub(c.id); renderSettingsExtras(); M.toast("Left the club."); });
    cl.querySelector("#setNewClub").onclick = () => { M.setView("club"); setTimeout(() => $("cbNew")?.click(), 50); };
  }
  if (st) {
    const n = myServices().size;
    st.innerHTML = `<b>My streaming services</b><p class="hint">${n ? `${n} picked. Titles on them get marked and you can filter the club watchlist with "📺 On my services".` : "Pick what you pay for to see which titles you can stream right away."}</p><button id="setSvc">${n ? "Change services" : "Pick services"}</button>`;
    st.querySelector("#setSvc").onclick = () => openServices(() => { renderSettingsExtras(); render(); });
  }
  if (pu) {
    const P = window.MarqueePush;
    if (!P?.ready) { pu.hidden = true; return; }
    pu.hidden = false;
    const on = P.on();
    pu.innerHTML = `<b>Notifications</b><p class="hint">${on ? "On for this device. You hear about suggestions, reviews and outings, even when Marquee is closed." : me ? "Get told about suggestions, reviews and outings, even when Marquee is closed. Turn it on for each phone or computer." : "Join or start a club first, then turn notifications on here."}</p>${me ? `<button id="setPushBtn">${on ? "Turn off" : "🔔 Turn on notifications"}</button>` : ""}`;
    pu.querySelector("#setPushBtn")?.addEventListener("click", async e => {
      e.target.disabled = true;
      if (on) { await P.disable(); M.toast("Notifications off for this device."); }
      else { const r = await P.enable(me.id); M.toast(r === true ? "Notifications on. A test one arrives within a few minutes." : r); if (r === true) P.send({ to: [me.id], title: "Marquee notifications work 🎬", body: "You'll hear about suggestions, reviews and outings, even when Marquee is closed." }); }
      renderSettingsExtras();
    });
  }
}
let wlStream = false, provBusy = false;
async function fillProv(items) {
  if (provBusy) return; provBusy = true;
  const todo = items.filter(w => !(provCache[key(w.m)] && now() - provCache[key(w.m)].t < PROV_TTL));
  const work = todo.slice();
  await Promise.all([1, 2, 3, 4].map(async () => { while (work.length) { const w = work.shift(); try { await getProv(w.m); } catch {} } }));
  provBusy = false; if (todo.length) render();
}

// ---------- suggestions (At home) ----------
function forYouCard(s, part) {
  // Once a friend logs a suggestion as watched (just now or seen before) it clears: from their list and from "You suggested".
  const mine = sugForMe(s), sent = sugSent(s).filter(g => sugTo(s, g).some(id => sugOpen(s, g, id))), today = iso(new Date());
  const due = mine.filter(g => accAt(s, g, me.id)), fresh = mine.filter(g => !accAt(s, g, me.id));
  const row = (g, out) => {
    const rec = sugTo(s, g), done = out ? rec.length && rec.every(id => !sugOpen(s, g, id)) : !sugOpen(s, g, me.id);
    const rv = id => s.saw[seenKey(g.m.n)]?.get(id);
    const who = rec.filter(id => !out || sugOpen(s, g, id)).map(id => `<span class="who${sugOpen(s, g, id) ? accAt(s, g, id) ? " acc" : "" : " ok"}"${rv(id)?.x ? ` title="${esc(rv(id).x)}"` : accAt(s, g, id) && sugOpen(s, g, id) ? ` title="Accepted, watching by ${esc(byLabel(accBy(s, g, id)))}"` : ""}>${sugOpen(s, g, id) ? accAt(s, g, id) ? "👍 " : "" : "✓ "}${esc(s.members.get(id)?.name || "someone")}${rv(id)?.v && rv(id).s ? ` ${rv(id).s}★` : ""}</span>`).join("");
    const by = accBy(s, g, me.id), late = by && by < today;
    return `<div class="wl-i sug-i${!out && !done && by && by <= isoAdd(today, 2) ? " due" : ""}${done ? " done" : ""}"><button class="wl-open" data-open="${esc(key(g.m))}">${poster(g.m.p, "w92")}${done ? `<i class="ok-badge" aria-label="${out ? "Everyone watched it" : "You watched it"}">✓</i>` : ""}</button><div class="body" data-open="${esc(key(g.m))}">
      <b>${esc(g.m.n)}${g.m.y ? ` <small>${esc(g.m.y)}</small>` : ""}${isTv(g.m) ? ` <span class="tv-tag">Series</span>` : ""}</b>
      ${out ? `<span class="whos">${who}</span>` : ""}<small class="hint">${[out ? (done ? "Everyone watched it" : g.to.includes("*") ? "To everyone" : "") : `From ${esc(g.by)}`,
        done ? (out ? "" : "You watched it") : out ? "" : by ? (late ? `⏰ was due ${esc(byLabel(by))}` : `👍 Watch by ${esc(byLabel(by))}`) : "New",
        (s.talk[seenKey(g.m.n)] || []).length ? `💬 ${(s.talk[seenKey(g.m.n)] || []).length}` : "", `<button class="link" data-sugdrop="${esc((g.ids || [g.id]).join(","))}">remove</button>`].filter(Boolean).join(" · ")}</small>
    </div>${out ? "" : !done && !by ? `<button class="acc-btn" data-acc="${esc(g.id)}">Accept</button>` : seenTag(g.m.n, true)}</div>`;
  };
  if (part === "sent") return sent.length ? `<div id="fySent"><h4 class="wl-sec">You suggested <i>${sent.length}</i></h4><div class="wl-list">${sent.map(g => row(g, true)).join("")}</div></div>` : "";
  if (part === "top") return `<div id="fyCard">
    ${(() => { const nr = newReviews(s); return nr.length ? `<div class="rev-new"><b>🎬 Your suggestions got watched</b>${nr.map(r => `<p><b>${esc(r.name)}</b> watched <b>${esc(r.m.n)}</b>${r.s ? ` <span class="stars">${starStr(r.s)}</span>` : ""}${r.x ? `<br><i>“${esc(r.x)}”</i>` : ""}</p>`).join("")}<button class="link" id="revRead">Got it</button></div>` : ""; })()}
    ${fresh.length ? `<h4 class="wl-sec">Suggested to you <i>${fresh.length}</i></h4><div class="wl-list">${fresh.map(g => row(g, false)).join("")}</div>` : ""}
    ${due.length ? `<h4 class="wl-sec">You'll watch <i>${due.length}</i></h4><div class="wl-list">${due.map(g => row(g, false)).join("")}</div>` : ""}
  </div>`;
  return `<div id="fyCard">
    ${(() => { const nr = newReviews(s); return nr.length ? `<div class="rev-new"><b>🎬 Your suggestions got watched</b>${nr.map(r => `<p><b>${esc(r.name)}</b> watched <b>${esc(r.m.n)}</b>${r.s ? ` <span class="stars">${starStr(r.s)}</span>` : ""}${r.x ? `<br><i>“${esc(r.x)}”</i>` : ""}</p>`).join("")}<button class="link" id="revRead">Got it</button></div>` : ""; })()}
    <h4 class="wl-sec">Suggestions <i>${fresh.length || ""}</i></h4>
    <div class="wl-list">${fresh.map(g => row(g, false)).join("") || `<p class="hint">Nothing new. When a friend suggests something, it shows up here.</p>`}</div>
    ${due.length ? `<h4 class="wl-sec">Accepted <i>${due.length}</i></h4><div class="wl-list">${due.map(g => row(g, false)).join("")}</div>` : ""}
    ${sent.length ? `<h4 class="wl-sec">You suggested <i>${sent.length}</i></h4><div class="wl-list">${sent.map(g => row(g, true)).join("")}</div>` : ""}
  </div>`;
}
function findTitle(s, k) {
  return s.wl.get(k)?.m || popList?.find(m => key(m) === k) || s.sugs.find(g => key(g.m) === k)?.m || [...s.outs.values()].find(o => key(o.m) === k)?.m || Object.values(s.saw).length && Object.keys(s.saw).map(sk => titleBySk(s, sk)).find(m => m && key(m) === k) || Object.values(s.picks).find(m => key(m) === k) || null;
}
function openTitleByKey(s, k, focusSuggest) { const m = findTitle(s, k); if (m) openTitle(s, m, focusSuggest); }
let titleSheet = null;
// Seasons on a series' title sheet: tap one to mark it watched and give it its own stars ("ss" dates and "sr" ratings on your saw event).
function seasonsRow(bg, s, sk, m) {
  const box = bg.querySelector(".ts-seasons"); if (!box) return;
  M.tm(`/tv/${m.i}`).then(j => {
    const list = (j.seasons || []).map(x => ({ n: x.season_number, eps: x.episode_count || 0, y: (x.air_date || "").slice(0, 4) })).filter(x => x.n > 0);
    const seasons = list.length ? list : Array.from({ length: j.number_of_seasons || 0 }, (_, i) => ({ n: i + 1, eps: 0, y: "" }));
    if (!seasons.length) { box.innerHTML = ""; return; }
    const draw = () => { const x = (lastState || s).saw[sk]?.get(me.id), mine = x?.v ? x : null;
      box.innerHTML = `<b class="ts-sh">Seasons</b><div class="ss-row">${seasons.map(q => { const on = !!mine?.ss && q.n in mine.ss, r = mine?.sr?.[q.n];
        return `<button class="ss-chip${on ? " on" : ""}" data-ssn="${q.n}">S${q.n}${on ? " ✓" : ""}${r ? ` <i>★${r}</i>` : ""}</button>`; }).join("")}</div>
        <small class="hint">Tap a season to mark it watched and rate it.</small>`;
      box.querySelectorAll("[data-ssn]").forEach(b => b.onclick = () => openSeason(s, sk, m, seasons.find(q => q.n === +b.dataset.ssn), draw)); };
    draw();
  }).catch(() => { box.innerHTML = ""; });
}
function openSeason(s0, sk, m, q, redraw) {
  const s = lastState || s0, prev = s.saw[sk]?.get(me.id)?.v ? s.saw[sk].get(me.id) : null, today = iso(new Date());
  const had = !!prev?.ss && q.n in prev.ss, d0 = had ? prev.ss[q.n] : "";
  let score = prev?.sr?.[q.n] || 0, old = had && !d0;
  const bg = el(`<div class="sheet-bg"><div class="sheet" role="dialog" aria-label="Season ${q.n}">
    <h3>${esc(m.n)} · Season ${q.n}</h3>${q.eps || q.y ? `<small class="hint">${[q.y, q.eps ? `${q.eps} episodes` : ""].filter(Boolean).join(" · ")}</small>` : ""}
    <div class="rev-btns rev-pick"${had ? " hidden" : ""}><button class="primary" data-when="now">Just watched</button><button data-when="old">Seen it before</button></div>
    <div class="rev-step2"${had ? "" : " hidden"}>
      <p class="rev-mode"><b>${old ? "Seen it before" : "Just watched"}</b> <button class="link" data-sw>change</button></p>
      <div class="mstars">${[1, 2, 3, 4, 5].map(n => `<button data-s="${n}" aria-label="${n} stars">★</button>`).join("")}</div>
      <small class="hint">Your stars for this season (tap twice for a half star). The series keeps its own rating.</small>
      <label class="rev-d"${old ? " hidden" : ""}>Watched on <input type="date" id="ssD" value="${d0 || today}" max="${today}"></label>
      <button class="primary" id="ssSave">Save</button>
    </div>
    ${had ? `<button class="link" id="ssUn">Mark season ${q.n} as not watched</button>` : ""}
    <button data-x>Close</button></div></div>`);
  document.body.appendChild(bg);
  paintStars(bg, score);
  bg.querySelectorAll(".mstars button").forEach(b => b.onclick = () => { score = halfTap(score, +b.dataset.s); paintStars(bg, score); });
  const step = o => { old = o; bg.querySelector(".rev-pick").hidden = true; bg.querySelector(".rev-step2").hidden = false; bg.querySelector(".rev-mode b").textContent = o ? "Seen it before" : "Just watched"; bg.querySelector(".rev-d").hidden = o; };
  bg.querySelectorAll("[data-when]").forEach(b => b.onclick = () => step(b.dataset.when === "old"));
  bg.querySelector("[data-sw]").onclick = () => { bg.querySelector(".rev-pick").hidden = false; bg.querySelector(".rev-step2").hidden = true; };
  const close = () => bg.remove();
  bg.addEventListener("click", e => { if (e.target === bg || e.target.closest("[data-x]")) close(); });
  const base = () => prev ? { ...(prev.s ? { s: prev.s } : {}), ...(prev.x ? { x: prev.x } : {}), ...(prev.old ? { old: 1 } : prev.d ? { d: prev.d } : {}) } : (old ? { old: 1 } : { d: bg.querySelector("#ssD").value || today });
  const mm = { t: m.t, i: m.i, n: m.n, y: m.y, p: m.p };
  bg.querySelector("#ssSave").onclick = () => {
    const ss = { ...(prev?.ss || {}) }, sr = { ...(prev?.sr || {}) };
    ss[q.n] = old ? "" : (bg.querySelector("#ssD").value || today); if (score) sr[q.n] = score; else delete sr[q.n];
    close(); act("saw", { sk, v: 1, ...base(), ss, ...(Object.keys(sr).length ? { sr } : {}), m: mm });
    M.toast(`Season ${q.n} of ${m.n} ${had ? "updated" : "marked as watched"}${score ? ` · ${starStr(score, true)}` : ""}.`); setTimeout(redraw, 50);
  };
  bg.querySelector("#ssUn")?.addEventListener("click", () => {
    const ss = { ...(prev?.ss || {}) }, sr = { ...(prev?.sr || {}) }; delete ss[q.n]; delete sr[q.n];
    close();
    if (!Object.keys(ss).length && !prev.s && !prev.x) act("saw", { sk, v: 0 });
    else act("saw", { sk, v: 1, ...base(), ss, ...(Object.keys(sr).length ? { sr } : {}), m: mm });
    M.toast(`Season ${q.n} unmarked.`); setTimeout(redraw, 50);
  });
}
function openTitle(s, m, focusSuggest) {
  titleSheet?.remove();
  const sk = seenKey(m.n), others = [...s.members.entries()].filter(([id]) => id !== me.id);
  const sugs = s.sugs.filter(g => key(g.m) === key(m));
  const forMe = sugs.filter(g => g.a !== me.id && sugTo(s, g).includes(me.id));
  const seen = [...(s.saw[sk] || new Map()).entries()].filter(([, x]) => x.v && (!x.m || key(x.m) === key(m))).map(([id, x]) => id === me.id ? "you" : x.name);
  const talk = (s.talk[sk] || []).slice(-30);
  const wl = s.wl.get(key(m));
  const next = iso(nightAfter(now(), s.day));
  const bg = el(`<div class="sheet-bg"><div class="sheet title-sheet" role="dialog" aria-label="${esc(m.n)}">
    <div class="ts-head">${poster(m.p, "w154")}<div class="ts-hd">
      <h3>${esc(m.n)}</h3>
      <small class="ts-meta">${isTv(m) ? "Series" : "Film"}${m.y ? ` · ${esc(m.y)}` : ""}<span class="ts-facts"></span></small>
      <small class="ts-by hint"></small>
      <div class="ts-rate">
        <div class="ts-score"><span class="rring big" style="--p:0;--c:#3d3747"><b>–</b></span><div><b class="ts-lbl">TMDB</b><small class="hint">Loading…</small></div></div>
        ${(() => { const club = [...(s.saw[sk] || new Map()).values()].map(x => x.v && x.s).filter(Boolean), cAvg = club.length ? club.reduce((x, y) => x + y, 0) / club.length : 0;
          return `<div class="ts-score club">${cAvg ? `<span class="rring big" style="--p:${Math.round(cAvg * 20)};--c:var(--accent)"><b>${cAvg.toFixed(1)}</b></span>` : `<span class="rring big" style="--p:0;--c:var(--accent)"><b>–</b></span>`}<div><b class="ts-lbl">Club${cAvg ? ` <span class="ts-stars" style="--c:var(--accent)">${starStr(cAvg)}</span>` : ""}</b><small class="hint">${cAvg ? `${club.length} rating${club.length === 1 ? "" : "s"}` : "No ratings yet"}${seen.length ? ` · watched by ${esc(seen.join(", "))}` : ""}</small></div></div>`; })()}
      </div></div></div>
    <div class="ts-btns">
      <button class="ts-btn${wl?.adders.has(me.id) ? " on" : ""}" data-tslist>${wl?.adders.has(me.id) ? "✓ On my list" : "＋ My list"}</button>
      <button class="ts-btn${s.saw[sk]?.get(me.id)?.v && (!s.saw[sk].get(me.id).m || key(s.saw[sk].get(me.id).m) === key(m)) ? " on" : ""}" data-tsw>${s.saw[sk]?.get(me.id)?.v && (!s.saw[sk].get(me.id).m || key(s.saw[sk].get(me.id).m) === key(m)) ? "✓ Watched" : "👁 Watched?"}</button>
    </div>
    ${(() => { const pv = s.sawPrev[sk]?.get(me.id), cur = s.saw[sk]?.get(me.id); if (!pv || (cur?.v && (!pv.x || cur.x === pv.x) && (!pv.d || cur.d === pv.d) && (!pv.s || cur.s === pv.s))) return "";
      return `<button class="chip ts-restore" data-tsrestore>↺ Bring back your earlier log${pv.m?.y ? ` of ${esc(pv.m.n)} (${esc(pv.m.y)})` : ""}${pv.d ? ` · ${esc(pv.d)}` : ""}${pv.s ? ` · ${starStr(pv.s, true)}` : ""}${pv.x ? ` · “${esc(pv.x.slice(0, 50))}”` : ""}</button>`; })()}
    <div class="ts-acts">
      ${others.length ? `<button class="ts-act" id="tsSugOpen"><span>📣</span>Suggest</button>` : ""}
      <button class="ts-act" data-tspost><span>📸</span>Post</button>
      <a class="ts-act" href="${esc(imdbUrl(m))}" target="_blank" rel="noopener"><span>🔗</span>IMDb</a>
      <button class="ts-act" data-tsmore><span>✎</span>Fix title</button>
    </div>
    <div class="ts-fix" hidden><button class="chip" data-tsfix>Wrong match? Pick the right one</button>${m.t === "tv" ? `<button class="chip" data-tsfilm>${isTv(m) ? "🎬 It's a film" : "📺 It's a series"}</button>` : ""}</div>
    ${others.length ? `<div class="ts-sug" hidden><div class="wl-views ts-to"><button class="chip" data-to="*">Everyone</button>${others.map(([id, x]) => `<button class="chip" data-to="${esc(id)}">${esc(x.name)}</button>`).join("")}</div>
      <button class="primary" id="tsGo" disabled>Pick who to suggest it to</button></div>` : ""}
    ${wl && [...wl.adders.keys()].some(a => a !== me.id) ? `<small class="hint">On ${esc([...wl.adders.entries()].filter(([a]) => a !== me.id).map(([, n]) => n).join(", "))}'s list</small>` : ""}
    ${isTv(m) ? `<div class="ts-seasons"><small class="hint">Loading seasons…</small></div>` : ""}
    <div class="ts-info"><small class="hint">Loading info…</small></div>
    <div class="ts-prov"><small class="hint">Where to stream…</small></div>
    ${forMe.map(g => `<div class="sug-due">Suggested by ${esc(g.by)}${!sugOpen(s, g, me.id) ? " · you watched it" : accAt(s, g, me.id) ? ` · 👍 you'll watch it by ${esc(byLabel(accBy(s, g, me.id)))}` : ` <button class="primary acc-btn" data-acc="${esc(g.id)}">Accept</button>`}</div>`).join("")}
    ${sugs.length ? `<small class="hint">${sugs.map(g => `${g.a === me.id ? "You" : esc(g.by)} → ${esc(whoLabel(s, g))}${g.a === me.id ? ` <button class="link" data-sugdrop="${esc(g.id)}">remove</button>` : ""}`).join(" · ")}</small>` : ""}
    ${(() => { const rs = [...(s.saw[sk] || new Map()).entries()].filter(([, x]) => x.v && (x.s || x.x)); const n = rs.length + talk.length;
      return `<h4 class="wl-sec">Reviews &amp; talk <i>${n || ""}</i></h4><div class="ts-talk">${rs.map(([id, x]) => `<p class="ts-rev${id === me.id ? " mine" : ""}"${id === me.id ? " data-tsedit" : ""}><b>${esc(id === me.id ? "You" : x.name)}</b>${x.s ? ` <span class="stars">${starStr(x.s)}</span>` : ""}${x.x ? ` ${esc(x.x)}` : ""}${id === me.id ? ` <button class="link ts-edit">✎ change</button>` : ""}</p>`).join("")}${talk.map(e => `<p><b>${esc(e.a === me.id ? "You" : e.n)}</b> ${esc(e.x)}</p>`).join("") || (rs.length ? "" : `<small class="hint">No reviews or thoughts yet.</small>`)}</div>`; })()}
    <div class="say"><input type="text" id="tsSay" maxlength="600" placeholder="Share what you thought…" enterkeyhint="send"><button class="primary" id="tsSend">Send</button></div>
    <button id="tsClose">Close</button></div></div>`);
  document.body.appendChild(bg); titleSheet = bg;
  titleInfo(m).then(i => {
    const box = bg.querySelector(".ts-info"); if (!box) return;
    if (!i) { box.innerHTML = ""; return; }
    const fmtN = n => n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k" : String(n);
    const fx = bg.querySelector(".ts-facts"); if (fx) fx.textContent = [i.genres, i.len].filter(Boolean).map(x => " · " + x).join("");
    const by = bg.querySelector(".ts-by"); if (by && i.by) by.innerHTML = `${m.t === "tv" ? "Created by" : "Directed by"} <b>${esc(i.by)}</b>`;
    const sc = bg.querySelector(".ts-score:not(.club)");
    if (sc) sc.innerHTML = i.rate ? `${rateRing(+i.rate, 1)}<div><b class="ts-lbl">TMDB <span class="ts-stars" style="--c:${rateCol(+i.rate)}">${starStr(+i.rate / 2)}</span></b><small class="hint">${fmtN(i.votes)} vote${i.votes === 1 ? "" : "s"}</small></div>`
      : `<span class="rring big" style="--p:0;--c:#3d3747"><b>–</b></span><div><b class="ts-lbl">TMDB</b><small class="hint">No rating yet</small></div>`;
    box.innerHTML = `
      ${i.cast ? `<small class="hint">With ${esc(i.cast)}</small>` : ""}
      ${i.plot ? `<p class="ts-plot">${esc(i.plot)}</p>` : ""}
      ${i.trailer ? `<a class="link" href="https://www.youtube.com/watch?v=${esc(i.trailer)}" target="_blank" rel="noopener">▶ Watch the trailer</a>` : ""}`;
    box.querySelector(".ts-plot")?.addEventListener("click", e => e.currentTarget.classList.toggle("open"));
  });
  getProv(m).then(pv => {
    const box = bg.querySelector(".ts-prov"); if (!box) return; const mine = myServices();
    box.innerHTML = pv.l.length ? `<span class="provs">${provLogos(pv.l, mine)}</span><small class="hint">${pv.l.some(p => mine.has(p.id)) ? "On your services" : "Streaming in Belgium"}${pv.u ? ` · <a class="link" href="${esc(pv.u)}" target="_blank" rel="noopener">all options ↗</a>` : ""}</small>`
      : `<small class="hint">Not streaming in Belgium right now${pv.u ? ` · <a class="link" href="${esc(pv.u)}" target="_blank" rel="noopener">rent or buy ↗</a>` : ""}</small>`;
  }).catch(() => { const box = bg.querySelector(".ts-prov"); if (box) box.innerHTML = ""; });
  const to = new Set();
  const go = bg.querySelector("#tsGo");
  const sync = () => {
    bg.querySelectorAll("[data-to]").forEach(b => b.classList.toggle("on", to.has(b.dataset.to) || (b.dataset.to !== "*" && to.has("*"))));
    if (go) { go.disabled = !to.size; go.textContent = to.size ? `Suggest to ${to.has("*") ? "everyone" : [...to].map(id => s.members.get(id)?.name).join(", ")}` : "Pick who to suggest it to"; }
  };
  bg.querySelectorAll("[data-to]").forEach(b => b.onclick = () => { const id = b.dataset.to; if (id === "*") { to.has("*") ? to.clear() : (to.clear(), to.add("*")); } else { to.delete("*"); to.has(id) ? to.delete(id) : to.add(id); } sync(); });
  go?.addEventListener("click", () => {
    const d = iso(new Date()), wk = 0, list = [...to];
    const names = list.includes("*") ? "everyone" : list.map(id => s.members.get(id)?.name).join(", ");
    close(); act("sug", { m, to: list, d, wk }, { to: list.includes("*") ? undefined : list, title: `${me.name} suggests ${m.n}`, body: "Open Marquee to accept it." });
    M.toast(`Suggested ${m.n} to ${names}.`);
  });
  const say = () => { const i = bg.querySelector("#tsSay"), x = i.value.trim(); if (!x) return; i.value = ""; act("say", { sk, x }, { title: `${me.name} on ${m.n}`, body: x.slice(0, 200) }).then(() => { const n = derive(active().id); close(); openTitle(n, m); }); };
  bg.querySelector("#tsSend").onclick = say;
  bg.querySelector("#tsSay").addEventListener("keydown", e => { if (e.key === "Enter" && !e.isComposing) say(); });
  const close = () => { bg.remove(); if (titleSheet === bg) titleSheet = null; };
  if (isTv(m)) seasonsRow(bg, s, sk, m);
  bg.addEventListener("click", e => { if (e.target === bg || e.target.id === "tsClose") close(); });
  bg.querySelector("[data-tsfix]")?.addEventListener("click", () => { bg.remove(); openSearch("Pick the right one", m2 => { if (key(m2) === key(m)) return; act("fix", { from: key(m), m: m2 }); M.toast(`Changed to ${m2.n}${m2.y ? ` (${m2.y})` : ""} for everyone.`); }, m.n); });
  bg.querySelector("[data-tsmore]")?.addEventListener("click", e => { const f = bg.querySelector(".ts-fix"); f.hidden = !f.hidden; e.currentTarget.classList.toggle("on", !f.hidden); if (!f.hidden) f.scrollIntoView({ block: "nearest" }); });
  bg.querySelector("[data-tsrestore]")?.addEventListener("click", () => { const pv = s.sawPrev[sk]?.get(me.id); if (!pv) return; close();
    act("saw", { sk, v: 1, ...(pv.old ? { old: 1 } : pv.d ? { d: pv.d } : {}), ...(pv.s ? { s: pv.s } : {}), ...(pv.x ? { x: pv.x } : {}), ...(pv.ss ? { ss: pv.ss } : {}), ...(pv.sr ? { sr: pv.sr } : {}), ...(pv.m ? { m: pv.m } : {}) });
    M.toast(`Your log of ${pv.m?.n || m.n} is back.`); });
  bg.querySelector("[data-tspost]")?.addEventListener("click", () => { const x = s.saw[sk]?.get(me.id); bg.remove(); titleSheet = null; M.open(m.t, m.i, m.n, x?.v ? { rating: x.s ? x.s * 2 : null, take: x.x || "" } : {}); });
  bg.querySelector("[data-tsfilm]")?.addEventListener("click", () => { const f = isTv(m); act("film", { from: key(m), v: f ? 1 : 0 }); M.toast(`${m.n} now shows as a ${f ? "film" : "series"} for everyone.`); bg.remove(); });
  const reopen = () => setTimeout(() => { if (!bg.isConnected) return; close(); openTitle(derive(active().id), m); }, 80);
  bg.querySelector("[data-tslist]")?.addEventListener("click", () => { const on = !!wl?.adders.has(me.id); act(on ? "wldrop" : "wl", { m }); M.toast(on ? `${m.n} removed from your list.` : `${m.n} added to your list.`); reopen(); });
  bg.querySelector("[data-tsw]")?.addEventListener("click", e => { const x = s.saw[sk]?.get(me.id), mine = !!x?.v && (!x.m || key(x.m) === key(m)); close(); openReview(s, sk, m); });
  bg.querySelector("[data-tsedit]")?.addEventListener("click", () => { close(); openReview(s, sk, m); });
  const sugOpenBtn = bg.querySelector("#tsSugOpen"), sugBox = bg.querySelector(".ts-sug");
  sugOpenBtn?.addEventListener("click", () => { sugBox.hidden = !sugBox.hidden; sugOpenBtn.classList.toggle("on", !sugBox.hidden); if (!sugBox.hidden) sugBox.scrollIntoView({ block: "nearest" }); });
  if (focusSuggest && sugOpenBtn) { sugOpenBtn.click(); setTimeout(() => bg.querySelector(".ts-to")?.scrollIntoView({ block: "center" }), 50); }
}


// ---------- Lists: imports, your own lists and ready-made ones (Oscars, top rated…), with a badge for every list you finish ----------
let listsEl = null;
function openListsTab() { lsPane = "lists"; LS.set("marqueeLsPane", lsPane); M.setView("club"); setClubTab("lists"); render(); }
let wlApi = null, lsOpen = null, oscYear = new Date().getFullYear(), oscMode = "win", bestYear = new Date().getFullYear() - 1;
const myLists = () => Object.values(LS.get("marqueeLists", {})).filter(l => l && !l.gone && Array.isArray(l.items)).sort((a, b) => (b.at || 0) - (a.at || 0));
function saveList(l) { const all = LS.get("marqueeLists", {}); all[l.id] = { ...l, at: now() }; LS.set("marqueeLists", all); window.MarqueeAccount?.save?.(); }
function dropList(id) { const all = LS.get("marqueeLists", {}); if (all[id]) all[id] = { id, gone: 1, at: now() }; LS.set("marqueeLists", all); }
const sawIt = (s, m) => { const x = s.saw[seenKey(m.n)]?.get(me.id); return (!!x?.v && (!x.m || key(x.m) === key(m))) || !!s.sawAlt[key(m)]?.get(me.id)?.v; };
const listProg = (s, l) => { const n = l.items.filter(m => sawIt(s, m)).length; return { n, total: l.items.length, done: l.items.length > 0 && n === l.items.length }; };
// Only the club's list maker (whoever started the club, or already has lists) sees the tools; everyone else gets the lists they published.
const listMaker = s => s.owner === me.id || myLists().length > 0;
const allLists = s => { const mine = listMaker(s) ? myLists() : []; return [...mine, ...s.pub.filter(p => !mine.some(l => l.id === p.id))]; };
const pubOf = (s, l) => s.pub.find(p => p.id === l.id);
const sameItems = (a, b) => a.length === b.length && a.every((m, i) => key(m) === key(b[i]));
function publishList(l) {
  const pv = now().toString(36), np = Math.max(1, Math.ceil(l.items.length / 20)), parts = [];
  for (let pt = 0; pt < np; pt++) parts.push(["list", { lid: l.id, pv, name: l.name, pt, np, items: l.items.slice(pt * 20, pt * 20 + 20).map(m => ({ t: m.t, i: m.i, n: m.n, y: m.y || "", p: m.p || "" })) }]);
  actMany(parts, { title: `${me.name} shared a list: ${l.name}`, body: `${l.items.length} titles. Open Lists to add it to your watchlist and tick off what you've seen.` });
}
const tmdbToM = (x, t = "movie") => ({ t, i: x.id, n: x.title || x.name || "", y: (x.release_date || x.first_air_date || "").slice(0, 4), p: x.poster_path || "" });
// Oscar data comes from Wikidata (free, no key): every film that won (or was nominated for) an Academy Award in a ceremony year, with its TMDB id.
async function wikidata(q) {
  const r = await fetch("https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent(q), { headers: { Accept: "application/sparql-results+json" } });
  if (!r.ok) throw new Error("wikidata " + r.status);
  return (await r.json()).results.bindings;
}
async function tmdbFilms(ids) {
  const work = [...new Set(ids)], out = new Map();
  await Promise.all([1, 2, 3, 4].map(async () => { while (work.length) { const id = work.shift(); try { const j = await M.tm(`/movie/${id}`); out.set(id, tmdbToM(j)); } catch {} } }));
  return ids.map(id => out.get(id)).filter(Boolean).filter((m, i, a) => a.findIndex(o => o.i === m.i) === i);
}
async function byTitles(pairs) {
  const near = (l, y) => (l || []).find(x => Math.abs(+(x.release_date || "").slice(0, 4) - y) <= 1);
  const out = await Promise.all(pairs.map(async ([q, y, alt]) => { try {
    for (const t of [q, alt].filter(Boolean)) { const x = near((await M.tm("/search/movie", { query: t, year: y })).results, y) || near((await M.tm("/search/movie", { query: t })).results, y); if (x) return tmdbToM(x); }
    return null; } catch { return null; } }));
  return out.filter(Boolean);
}
const GENRES = [[28, "Action"], [12, "Adventure"], [16, "Animation"], [35, "Comedy"], [80, "Crime"], [99, "Documentary"], [18, "Drama"], [10751, "Family"], [14, "Fantasy"], [36, "History"], [27, "Horror"], [10402, "Music"], [9648, "Mystery"], [10749, "Romance"], [878, "Science fiction"], [53, "Thriller"], [10752, "War"], [37, "Western"]];
let genType = LS.get("marqueeGenType", "person"), genQ = { person: "", topic: "" }, genGenre = 27, genBusy = false, genMsg = "";
const OSC = `?award rdfs:label ?al. FILTER(LANG(?al) = "en" && STRSTARTS(?al, "Academy Award for"))`;
const READY = {
  osc: { name: y => `Oscar winners ${y}`, load: async y => {
    const rows = await wikidata(`SELECT DISTINCT ?tmdb ?al WHERE { { ?film p:P166 ?st. ?st ps:P166 ?award; pq:P585 ?t. } UNION { ?x p:P166 ?st. ?st ps:P166 ?award; pq:P585 ?t; pq:P1686 ?film. } ${OSC} FILTER(YEAR(?t) = ${+y}) ?film wdt:P4947 ?tmdb. }`);
    const score = {}; for (const r of rows) { const id = +r.tmdb.value; score[id] = (score[id] || 0) + (/Best Picture/.test(r.al.value) ? 100 : 1); }
    return tmdbFilms(Object.keys(score).map(Number).sort((a, b) => score[b] - score[a])); } },
  oscnom: { name: y => `Best Picture nominees ${y}`, load: async y => {
    const rows = await wikidata(`SELECT DISTINCT ?tmdb WHERE { ?film p:P1411 ?st. ?st ps:P1411 wd:Q102427; pq:P585 ?t. FILTER(YEAR(?t) = ${+y}) ?film wdt:P4947 ?tmdb. }`);
    return tmdbFilms(rows.map(r => +r.tmdb.value)); } },
  bp: { name: () => "Every Best Picture winner", load: async () => {
    const rows = await wikidata(`SELECT DISTINCT ?tmdb (MIN(YEAR(?t)) AS ?y) WHERE { ?film p:P166 ?st. ?st ps:P166 wd:Q102427; pq:P585 ?t. ?film wdt:P4947 ?tmdb. } GROUP BY ?tmdb ORDER BY DESC(?y)`);
    return tmdbFilms(rows.map(r => +r.tmdb.value)); } },
  dir: { name: y => READY.dir.acting ? `Every film with ${y}` : `Every film by ${y}`, load: async q => {
    const pp = (await M.tm("/search/person", { query: q })).results || [], person = pp[0]; // a director gets the films they directed, an actor their roles
    if (!person) return [];
    READY.dir.who = person.name; READY.dir.acting = person.known_for_department === "Acting";
    const cr = await M.tm(`/person/${person.id}/movie_credits`);
    const src = READY.dir.acting ? (cr.cast || []).filter(x => !/uncredited|himself|herself|archive/i.test(x.character || "")) : (cr.crew || []).filter(x => x.job === "Director");
    return src.filter(x => x.release_date && x.release_date <= iso(new Date()) && !(x.genre_ids || []).includes(99)).sort((a, b) => a.release_date.localeCompare(b.release_date)).map(x => tmdbToM(x)).filter((m, i, a) => a.findIndex(o => o.i === m.i) === i); } },
  top: { name: () => "Top 100 rated films", load: async () => (await Promise.all([1, 2, 3, 4, 5].map(page => M.tm("/movie/top_rated", { page })))).flatMap(d => d.results || []).map(x => tmdbToM(x)).slice(0, 100) },
  // Hand-picked lists: titles + years, matched on TMDB when you open them.
  lee: { name: () => "Christopher Lee as Dracula", load: () => byTitles([["Dracula", 1958], ["Dracula: Prince of Darkness", 1966], ["Dracula Has Risen from the Grave", 1968], ["Taste the Blood of Dracula", 1970], ["Scars of Dracula", 1970], ["Count Dracula", 1970], ["Dracula A.D. 1972", 1972], ["The Satanic Rites of Dracula", 1973], ["Dracula and Son", 1976, "Dracula père et fils"]]) },
  // Every film TMDB tags "based on video game" (with enough votes to be a real release), oldest first.
  game: { name: () => "Video game movies", load: async () => {
    const kw = ((await M.tm("/search/keyword", { query: "based on video game" })).results || []).find(k => k.name === "based on video game") || { id: 41645 };
    const first = await M.tm("/discover/movie", { with_keywords: kw.id, sort_by: "primary_release_date.asc", "vote_count.gte": 50, page: 1 });
    const pages = Math.min(first.total_pages || 1, 15), rest = pages > 1 ? await Promise.all(Array.from({ length: pages - 1 }, (_, i) => M.tm("/discover/movie", { with_keywords: kw.id, sort_by: "primary_release_date.asc", "vote_count.gte": 50, page: i + 2 }))) : [];
    return [first, ...rest].flatMap(d => d.results || []).filter(x => x.release_date && x.release_date <= iso(new Date())).map(x => tmdbToM(x)).filter((m, i, a) => a.findIndex(o => o.i === m.i) === i); } },
  // Any topic TMDB tags films with: "zombie", "time travel", "heist", "based on novel or book"…
  topic: { name: q => `${q[0].toUpperCase()}${q.slice(1)} movies`, load: async q => {
    const find = async t => ((await M.tm("/search/keyword", { query: t })).results || []);
    let ks = await find(q); if (!ks.length && /s$/i.test(q)) ks = await find(q.replace(/s$/i, ""));
    const k = ks.find(x => x.name.toLowerCase() === q.toLowerCase() || x.name.toLowerCase() === q.toLowerCase().replace(/s$/, "")) || ks[0];
    if (!k) return [];
    READY.topic.who = k.name;
    const go = page => M.tm("/discover/movie", { with_keywords: k.id, sort_by: "primary_release_date.asc", "vote_count.gte": 25, page });
    const first = await go(1), n = Math.min(first.total_pages || 1, 15), rest = n > 1 ? await Promise.all(Array.from({ length: n - 1 }, (_, i) => go(i + 2))) : [];
    return [first, ...rest].flatMap(d => d.results || []).filter(x => x.release_date && x.release_date <= iso(new Date())).map(x => tmdbToM(x)).filter((m, i, a) => a.findIndex(o => o.i === m.i) === i); } },
  genre: { name: g => `Best ${GENRES.find(x => x[0] === +g)?.[1].toLowerCase() || ""} films`, load: async g => (await Promise.all([1, 2, 3, 4, 5].map(page => M.tm("/discover/movie", { with_genres: g, sort_by: "vote_average.desc", "vote_count.gte": 1500, page })))).flatMap(d => d.results || []).map(x => tmdbToM(x)).filter((m, i, a) => a.findIndex(o => o.i === m.i) === i).slice(0, 100) },
  best: { name: y => `Best films of ${y}`, load: async y => (await Promise.all([1, 2].map(page => M.tm("/discover/movie", { primary_release_year: y, sort_by: "vote_average.desc", "vote_count.gte": 300, page })))).flatMap(d => d.results || []).map(x => tmdbToM(x)).slice(0, 30) },
};
function listTiles(s, items, canDrop) {
  return `<div class="wl-grid">${items.map(m => { const r = rateOf(m); return `<button class="wl-tile" data-lsopen="${esc(key(m))}" aria-label="${esc(m.n)}">${poster(m.p, "w342")}${sawIt(s, m) ? `<i class="tile-ok" aria-label="You watched it">✓</i>` : ""}${canDrop ? `<i class="ls-x" data-lsx="${esc(key(m))}" aria-label="Remove">✕</i>` : ""}<span class="tile-t"><b>${esc(m.n)}</b><small>${esc(m.y || "")}${r ? rateRing(r) : ""}</small></span></button>`; }).join("")}</div>`;
}
function openListSheet(s, l, ready, keepY) {
  const p = listProg(s, l), unseen = l.items.filter(m => !sawIt(s, m));
  const onWl = new Set([...s.wl.values()].filter(w => w.adders.has(me.id)).map(w => key(w.m))), toAdd = unseen.filter(m => !onWl.has(key(m)));
  const club = !!l.club, mine = !ready && !club, pub = mine && pubOf(s, l), stale = pub && (pub.name !== l.name || !sameItems(pub.items, l.items));
  const bg = el(`<div class="sheet-bg"><div class="sheet ls-sheet" role="dialog" aria-label="${esc(l.name)}">
    <h3>${p.done ? "🏅 " : ""}${esc(l.name)}</h3>
    <div class="ls-prog"><i style="width:${p.total ? Math.round(p.n / p.total * 100) : 0}%"></i></div>
    <small class="hint">${p.total ? `You've seen ${p.n} of ${p.total}${p.done ? " · badge earned!" : ` · see them all for a badge`}${club && l.by ? ` · from ${esc(l.by)}` : ""}` : "Empty list. Add titles below."}</small>
    <div class="ts-btns">${toAdd.length ? `<button class="ts-btn" data-lsa="wl">＋ ${club ? `Add list to my watchlist (${toAdd.length})` : `${toAdd.length} to my watchlist`}</button>` : `<button class="ts-btn on" disabled>${unseen.length ? "✓ All on your watchlist" : "✓ All seen"}</button>`}${ready ? `<button class="ts-btn" data-lsa="save">💾 Save as my list</button>` : mine ? `<button class="ts-btn" data-lsa="add">＋ Add title</button>` : ""}</div>
    ${mine && l.items.length ? `<div class="ls-pub">${pub ? `<span>📣 Shared with the club${stale ? " · you changed it since" : ""}</span>${stale ? `<button class="ts-btn" data-lsa="pub">Update</button>` : ""}<button class="link" data-lsa="unpub">Stop sharing</button>` : `<button class="primary" data-lsa="pub">📣 Share with the club</button>`}</div>` : ""}
    ${p.total && !p.done ? `<small class="hint">Tap a poster you've already seen to tick it off.</small>` : ""}
    ${listTiles(s, l.items, mine)}
    ${mine ? `<button class="link" data-lsa="del">Delete this list</button>` : ""}
    <button data-lsa="x">Close</button></div></div>`);
  document.body.appendChild(bg);
  const close = () => bg.remove(), sh = bg.querySelector(".sheet"), scrollOf = () => Math.max(sh.scrollTop, bg.scrollTop);
  if (keepY) { sh.scrollTop = keepY; bg.scrollTop = keepY; }
  bg.addEventListener("click", e => {
    if (e.target === bg) return close();
    const x = e.target.closest("[data-lsx]"); if (x) { e.stopPropagation(); l.items = l.items.filter(m => key(m) !== x.dataset.lsx); const y = scrollOf(); saveList(l); close(); render(); openListSheet(lastState, l, false, y); return; }
    const t = e.target.closest("[data-lsopen]"); if (t) { const m = l.items.find(m => key(m) === t.dataset.lsopen); if (!m) return; const y = scrollOf(); close();
      if (sawIt(s, m)) openTitle(s, m); else { act("saw", { sk: seenKey(m.n), v: 1, old: 1, m: { t: m.t, i: m.i, n: m.n, y: m.y, p: m.p } }); M.toast(`✓ ${m.n} marked as seen.`); openListSheet(lastState, club ? lastState.pub.find(x => x.id === l.id) || l : l, ready, y); }
      return; }
    const a = e.target.closest("[data-lsa]")?.dataset.lsa; if (!a) return;
    if (a === "x") close();
    if (a === "wl") { actMany(toAdd.map(m => ["wl", { m }]), { title: `${me.name} added ${toAdd.length} title${toAdd.length === 1 ? "" : "s"} to the club watchlist`, body: l.name }); M.toast(`${toAdd.length} title${toAdd.length === 1 ? "" : "s"} from ${l.name} added to your Personal watchlist.`); close(); }
    if (a === "pub") { publishList(l); M.toast(pub ? `Updated "${l.name}" for the club.` : `Shared "${l.name}" with the club.`); close(); render(); openListSheet(lastState, l); }
    if (a === "unpub" && confirm(`Stop sharing "${l.name}"? It disappears from everyone's Lists; their ticks stay.`)) { act("unlist", { lid: l.id }); close(); render(); openListSheet(lastState, l); }
    if (a === "save") { const nl = { id: "l" + rand(8), name: l.name, items: l.items, src: l.src || "" }; saveList(nl); M.toast(`Saved "${l.name}" to your lists.`); close(); render(); }
    if (a === "add") { close(); openSearch(`Add to ${l.name}`, m => { if (!l.items.some(o => key(o) === key(m))) { l.items.push(m); saveList(l); } render(); openListSheet(lastState, l); }); }
    if (a === "del" && confirm(`Delete "${l.name}"? Your watchlist and badges from other lists stay.`)) { if (pub) act("unlist", { lid: l.id }); dropList(l.id); close(); render(); }
  });
}
async function openReady(s, kind, y) {
  const r = READY[kind]; let name = r.name(y);
  const say = t => { genMsg = t; const m = $("genMsg"); if (m) { m.textContent = t; m.hidden = !t; } const g = $("genGo"); if (g) { g.disabled = genBusy; g.textContent = genBusy ? "Making the list…" : "Make the list"; } };
  genBusy = true; say(`Looking up ${name}…`);
  try {
    const items = await r.load(y); if ((kind === "dir" || kind === "topic") && r.who) name = r.name(r.who);
    genBusy = false;
    if (!items.length) { say(`Found nothing for ${name}. Try another spelling or a different year.`); return; }
    say(""); openListSheet(lastState || s, { id: "", name, items, src: kind + (y ? ":" + y : "") }, true);
  } catch (e) { console.error(e); genBusy = false; say(`Couldn't load ${name}: ${kind.startsWith("osc") || kind === "bp" ? "the Oscar database (Wikidata) didn't answer" : "TMDB didn't answer"}. Check your connection and try again.`); }
}
function renderLists(s) {
  listsEl = $("listsView"); if (!listsEl) return;
  if (!listMaker(s)) return renderClubLists(s);
  const ls = myLists(), done = allLists(s).filter(l => listProg(s, l).done), hadFocus = document.activeElement?.id === "genQ";
  const yrs = Array.from({ length: new Date().getFullYear() - 1928 }, (_, i) => new Date().getFullYear() - i);
  listsEl.innerHTML = `    <div class="ls-cols">
    <div class="ls-sec"><h3>My lists</h3>
      ${ls.length ? `<div class="ls-list">${ls.map(l => { const p = listProg(s, l); return `<button class="ls-row${p.done ? " done" : ""}" data-lsid="${esc(l.id)}">${l.items[0] ? poster(l.items[0].p, "w92") : `<i class="ph"></i>`}<span><b>${p.done ? "🏅 " : ""}${esc(l.name)}</b><small>${p.n} of ${p.total} seen${pubOf(s, l) ? " · 📣 shared" : ""}</small><span class="ls-prog"><i style="width:${p.total ? Math.round(p.n / p.total * 100) : 0}%"></i></span></span></button>`; }).join("")}</div>` : `<p class="hint">No lists yet. Make one, or save a ready-made one below.</p>`}
      <button class="primary" id="lsNew">＋ New list</button>
      <p class="hint">Open a list and tap 📣 Share to put it in everyone's Lists.</p></div>
    <div class="ls-sec gen"><h3>Make a list</h3>
      <div class="gen-types">${[["person", "👤 Director or actor"], ["topic", "🏷️ Topic"], ["genre", "🎭 Best of a genre"], ["best", "⭐ Best of a year"], ["osc", "🏆 Oscars"], ["bp", "🎬 All Best Picture winners"], ["top", "💯 Top 100"], ["game", "🎮 Video games"], ["lee", "🧛 Lee as Dracula"]].map(([k, l]) => `<button class="chip${genType === k ? " on" : ""}" data-gt="${k}">${l}</button>`).join("")}</div>
      <div class="gen-ctl">${genType === "person" ? `<input type="search" id="genQ" placeholder="A name, e.g. Jenna Coleman" value="${esc(genQ.person)}" autocomplete="off" enterkeyhint="go">`
        : genType === "topic" ? `<input type="search" id="genQ" placeholder="e.g. zombies, time travel, heist" value="${esc(genQ.topic)}" autocomplete="off" enterkeyhint="go">`
        : genType === "genre" ? `<select id="genG" aria-label="Genre">${GENRES.map(([id, n]) => `<option value="${id}"${id === genGenre ? " selected" : ""}>${n}</option>`).join("")}</select>`
        : genType === "best" ? `<select id="genY" aria-label="Year">${yrs.map(y => `<option${y === bestYear ? " selected" : ""}>${y}</option>`).join("")}</select>`
        : genType === "osc" ? `<select id="genY" aria-label="Ceremony year">${yrs.map(y => `<option${y === oscYear ? " selected" : ""}>${y}</option>`).join("")}</select><div class="seg">${[["win", "All winners"], ["nom", "Best Picture nominees"]].map(([k, l]) => `<button class="${k === oscMode ? "on" : ""}" data-oscm="${k}">${l}</button>`).join("")}</div>`
        : `<small class="hint">${{ bp: "Every film that won Best Picture, newest first.", top: "TMDB's 100 highest rated films.", game: "Every film based on a video game, oldest first.", lee: "The 9 films where Christopher Lee plays Dracula." }[genType]}</small>`}</div>
      <button class="primary" id="genGo"${genBusy ? " disabled" : ""}>${genBusy ? "Making the list…" : "Make the list"}</button>
      <p class="hint" id="genMsg"${genMsg ? "" : " hidden"}>${esc(genMsg)}</p>
      <small class="hint">The list opens so you can check it, then 💾 Save it and 📣 Share it with the club.</small></div>
    <div class="ls-sec"><h3>Import</h3>
      <button class="imp-card" id="lsImp"><span class="imp-ic"><i class="imdb">IMDb</i><i class="lb"><b></b><b></b><b></b></i></span><span class="imp-tx"><b>Import from IMDb or Letterboxd</b><small>Watchlists go on your Personal watchlist; ratings and diaries mark titles as watched</small></span><span class="imp-go">›</span></button>
      <p class="hint" id="lsStatus"${wlMsg ? "" : " hidden"}>${esc(wlMsg)}</p></div>
    </div>`;
  const gq = listsEl.querySelector("#genQ"); if (gq) { if (hadFocus) { gq.focus(); try { gq.setSelectionRange(gq.value.length, gq.value.length); } catch {} } gq.oninput = () => { genQ[genType] = gq.value; }; gq.onkeydown = e => { if (e.key === "Enter") listsEl.querySelector("#genGo").click(); }; }
  listsEl.querySelector("#lsImp").onclick = () => wlApi?.openImport();
  listsEl.querySelector("#lsNew").onclick = () => { const n = (prompt("Name your list", "") || "").trim().slice(0, 60); if (!n) return; const l = { id: "l" + rand(8), name: n, items: [] }; saveList(l); render(); openListSheet(lastState, l); };
  listsEl.querySelectorAll("[data-lsid]").forEach(b => b.onclick = () => { const l = myLists().find(x => x.id === b.dataset.lsid); if (l) openListSheet(s, l); });
  listsEl.querySelectorAll("[data-gt]").forEach(b => b.onclick = () => { genType = b.dataset.gt; LS.set("marqueeGenType", genType); genMsg = ""; renderLists(s); listsEl.querySelector("#genQ")?.focus(); });
  listsEl.querySelectorAll("[data-oscm]").forEach(b => b.onclick = () => { oscMode = b.dataset.oscm; renderLists(s); });
  const gy = listsEl.querySelector("#genY"); if (gy) gy.onchange = e => { if (genType === "osc") oscYear = +e.target.value; else bestYear = +e.target.value; };
  const gg = listsEl.querySelector("#genG"); if (gg) gg.onchange = e => { genGenre = +e.target.value; };
  listsEl.querySelector("#genGo").onclick = () => { if (genBusy) return;
    if (genType === "person" || genType === "topic") { const q = (genQ[genType] || "").trim(); if (!q) { listsEl.querySelector("#genQ").focus(); return; } return openReady(s, genType === "person" ? "dir" : "topic", q); }
    if (genType === "osc") return openReady(s, oscMode === "nom" ? "oscnom" : "osc", oscYear);
    if (genType === "best") return openReady(s, "best", bestYear);
    if (genType === "genre") return openReady(s, "genre", genGenre);
    openReady(s, genType, 0); };
}

// What everyone but the list maker sees: the shared lists, plus their own import.
function renderClubLists(s) {
  const ls = s.pub, done = ls.filter(l => listProg(s, l).done), who = s.members.get(s.owner)?.name || "the club";
  listsEl.innerHTML = `    <div class="ls-cols">
    <div class="ls-sec"><h3>Club lists</h3>
      ${ls.length ? `<div class="ls-list">${ls.map(l => { const p = listProg(s, l); return `<button class="ls-row${p.done ? " done" : ""}" data-lsid="${esc(l.id)}">${poster(l.items[0].p, "w92")}<span><b>${p.done ? "🏅 " : ""}${esc(l.name)}</b><small>${p.n} of ${p.total} seen · from ${esc(l.by || who)}</small><span class="ls-prog"><i style="width:${Math.round(p.n / p.total * 100)}%"></i></span></span></button>`; }).join("")}</div>` : `<p class="hint">No lists yet. When ${esc(who)} shares one, it shows up here.</p>`}</div>
    <div class="ls-sec"><h3>Import</h3>
      <button class="imp-card" id="lsImp"><span class="imp-ic"><i class="imdb">IMDb</i><i class="lb"><b></b><b></b><b></b></i></span><span class="imp-tx"><b>Import from IMDb or Letterboxd</b><small>Watchlists go on your Personal watchlist; ratings and diaries mark titles as watched</small></span><span class="imp-go">›</span></button>
      <p class="hint" id="lsStatus"${wlMsg ? "" : " hidden"}>${esc(wlMsg)}</p></div>
    </div>`;
  listsEl.querySelector("#lsImp").onclick = () => wlApi?.openImport();
  listsEl.querySelectorAll("[data-lsid]").forEach(b => b.onclick = () => { const l = lastState?.pub.find(x => x.id === b.dataset.lsid) || ls.find(x => x.id === b.dataset.lsid); if (l) openListSheet(lastState || s, l); });
}

// ---------- test friends (only on this device) ----------
const DEMO = [
  { id: "demo_lotte", n: "Lotte", wl: ["Past Lives", "Aftersun", "Severance"], saw: ["Aftersun"] },
  { id: "demo_jonas", n: "Jonas", wl: ["Dune: Part Two", "The Bear", "Oppenheimer"], saw: ["Oppenheimer"] },
  { id: "demo_emma", n: "Emma", wl: ["Poor Things", "Fallen Leaves", "Shōgun"], saw: ["Fallen Leaves"] },
];
const hasDemo = clubId => Object.values(evs(clubId)).some(e => e.demo && !e.gone);
async function addDemo() {
  const c = active(); if (!c || !me) return;
  M.toast("Adding test friends…");
  const find = async q => { try { const j = await M.tm("/search/multi", { query: q }); const x = (j.results || []).find(r => r.media_type === "movie" || r.media_type === "tv"); return x ? { t: x.media_type, i: x.id, n: x.title || x.name, y: (x.release_date || x.first_air_date || "").slice(0, 4), p: x.poster_path || "" } : null; } catch { return null; } };
  const t0 = now() - 3600e3, list = []; let n = 0;
  const ev = (f, k, extra) => list.push({ i: "dm" + rand(8), k, a: f.id, n: f.n, t: t0 + (n++) * 1000, r: derive(c.id).cur, demo: 1, ...extra });
  const titles = {};
  for (const f of DEMO) { ev(f, "join"); for (const q of f.wl) { const m = titles[q] ||= await find(q); if (!m) continue; ev(f, "wl", { m }); if (f.saw.includes(q)) ev(f, "saw", { sk: seenKey(m.n), v: 1 }); } }
  const today = iso(new Date());
  if (titles["Past Lives"]) ev(DEMO[0], "sug", { m: titles["Past Lives"], to: [me.id], d: today });
  if (titles["Dune: Part Two"]) ev(DEMO[1], "sug", { m: titles["Dune: Part Two"], to: ["*"], d: today });
  if (titles["Poor Things"]) { ev(DEMO[2], "sug", { m: titles["Poor Things"], to: [me.id, "demo_jonas"], d: isoAdd(today, -3) }); ev(DEMO[1], "say", { sk: seenKey(titles["Poor Things"].n), x: "Saw the trailer, looks wild. Let's do it this week?" }); }
  // A few things the test friends watched, so their watched lists aren't empty.
  if (titles["Dune: Part Two"]) ev(DEMO[0], "saw", { sk: seenKey(titles["Dune: Part Two"].n), v: 1, s: 4, d: isoAdd(today, -30), x: "That sandworm ride!" });
  if (titles["Past Lives"]) ev(DEMO[1], "saw", { sk: seenKey(titles["Past Lives"].n), v: 1, s: 5, d: isoAdd(today, -12) });
  if (titles["Poor Things"]) ev(DEMO[0], "saw", { sk: seenKey(titles["Poor Things"].n), v: 1, old: 1, s: 3 });
  const wk = titles["Wicked: For Good"] ||= await find("Wicked: For Good");
  if (wk) { const sc = { c: "Kinepolis Gent", d: "", h: "", u: KP_URL }; ev(DEMO[2], "nom", { tr: "m", r: monthOf(new Date()), m: wk, sc }); ev(DEMO[1], "in", { ok: ckey({ m: wk, sc }), v: 1 }); }
  if (titles["Aftersun"]) ev(DEMO[0], "say", { sk: seenKey(titles["Aftersun"].n), x: "That ending wrecked me. Everyone needs to see this." });
  merge(c.id, list); setClubTab("weekly"); render(); M.toast(Object.keys(titles).some(k => titles[k]) ? "Lotte, Jonas and Emma joined (only on this device)." : "Test friends joined, but their films couldn't load. Check your connection.");
}
function removeDemo() {
  const c = active(); if (!c) return;
  const map = evs(c.id); for (const [i, e] of Object.entries(map)) if (e.demo && !e.gone) map[i] = { ...e, gone: "demo" };
  save(c.id); render(); M.toast("Test friends removed.");
}
// Back to right after the list imports: keeps imported watched titles and bulk-imported watchlists (and real friends' activity);
// removes test friends and everything else you did since. Reversible with Undo (the events are kept as tombstones).
function resetToImports() {
  const c = active(); if (!c) return;
  const map = evs(c.id), mine = Object.values(map).filter(e => e.a === me.id && !e.gone && !e.demo);
  const keep = new Set(mine.filter(e => e.k === "meta" || (e.k === "saw" && e.imp)).map(e => e.i));
  const wl = mine.filter(e => e.k === "wl").sort((a, b) => a.t - b.t); let run = [];
  const flush = () => { if (run.length >= 5) run.forEach(e => keep.add(e.i)); run = []; };
  for (const e of wl) { if (run.length && e.t - run[run.length - 1].t > 5) flush(); run.push(e); } flush();
  const tag = "reset" + now(); let n = 0;
  for (const [i, e] of Object.entries(map)) if (!e.gone && (e.demo || (e.a === me.id && !keep.has(i)))) { map[i] = { ...e, gone: tag }; n++; }
  LS.set("marqueeLastReset_" + c.id, tag); save(c.id); render();
  M.toast(`Reset: ${n} later change${n === 1 ? "" : "s"} removed. You can undo this in club settings.`);
}
function undoReset() {
  const c = active(); if (!c) return; const tag = LS.get("marqueeLastReset_" + c.id, ""); if (!tag) return;
  const map = evs(c.id); for (const [i, e] of Object.entries(map)) if (e.gone === tag) { const { gone, ...x } = e; map[i] = { ...x, back: 1 }; }
  // A restored event must beat its own tombstone everywhere, so it comes back under a new id.
  for (const [i, e] of Object.entries(map)) if (e.back) { const { back, ...x } = e; map[i] = { ...e, gone: tag }; const ni = "u" + rand(9); map[ni] = { ...x, i: ni }; }
  LS.set("marqueeLastReset_" + c.id, ""); save(c.id); render(); M.toast("Reset undone.");
}

function bindWl(s, cands) {
  const status = t => { wlMsg = t || ""; for (const id of ["wlStatus", "lsStatus"]) { const n = $(id); if (n) { n.hidden = !t; n.textContent = wlMsg; } } };
  const addAll = (ms, label, seenIt) => {
    const have = new Set([...s.wl.values()].filter(w => w.adders.has(me.id)).map(w => key(w.m)));
    const fresh = []; const seen = new Set();
    for (const m of ms) { const k = key(m); if ((have.has(k) && !seenIt) || seen.has(k)) continue; seen.add(k); fresh.push(m); }
    if (!fresh.length) { M.toast("Those are all on the club watchlist already."); return; }
    if (seenIt) {
      // Imported ratings/diary only mark titles as watched (with stars and dates); they don't go on anyone's to-watch list.
      actMany(fresh.map(({ _s, _d, _w, ...m }) => ["saw", { sk: seenKey(m.n), v: 1, imp: 1, m, ...(_d ? { d: _d, ...(_w ? { wd: 1 } : {}) } : {}), ...(_s ? { s: _s } : {}) }]), null);
      M.toast(`${fresh.length === 1 ? fresh[0].n : fresh.length + " titles"} marked as watched.`); return;
    }
    actMany(fresh.map(({ _s, _d, _w, ...m }) => ["wl", { m }]), { title: `${me.name} added ${fresh.length} film${fresh.length === 1 ? "" : "s"} to the club watchlist`, body: label });
    M.toast(`${fresh.length} film${fresh.length === 1 ? "" : "s"} added to your Personal watchlist.`);
  };
  const fromSearch = () => openSearch("Add to your Personal watchlist", m => addAll([m], m.n));
  // One small button holds sorting and the filters (films/series, on my services).
  // Sort and filter sit right above the tiles: one tap each.
  view.querySelectorAll(".wl-filt button").forEach(b => b.onclick = () => {
    if (b.dataset.so) { wlSort = b.dataset.so; LS.set("marqueeWlSort2", wlSort); wlAll = wlSort !== "genre"; }
    if (b.dataset.ty) wlType = b.dataset.ty;
    if (b.dataset.nb) wlNobody = b.dataset.nb === "1";
    if (b.dataset.st) { if (b.dataset.st === "1" && !myServices().size) { M.toast("Pick your streaming services in Settings first."); M.setView("settings"); return; } wlStream = b.dataset.st === "1"; }
    render();
  });
  view.querySelectorAll("[data-wlt]").forEach(b => b.onclick = () => { wlType = b.dataset.wlt; render(); });
  const fromSaved = () => addAll(LS.get("marqueeWatchlist", []).filter(x => x && x.id && (x.type === "movie" || x.type === "tv")).map(x => ({ t: x.type, i: x.id, n: x.title || "", y: String(x.year || ""), p: x.poster || "" })), "From their Marquee watchlist");
  const fromFile = () => { status("Pick the file you exported from IMDb or Letterboxd."); $("wlFile").click(); };
  // + Add: straight into search; importing a whole list is one tap below it.
  const openImport = () => {
    const saved = LS.get("marqueeWatchlist", []).length;
    const bg = el(`<div class="sheet-bg"><div class="sheet" role="dialog" aria-label="Import a list"><h3>Import a list</h3>
      <ol class="imp-steps"><li>Export your list: <a class="link" href="https://www.imdb.com/list/watchlist/" target="_blank" rel="noopener" data-a="go">IMDb ↗</a> (⋯ › Export, then <a class="link" href="https://www.imdb.com/exports/" target="_blank" rel="noopener" data-a="go">Exports page ↗</a>) or <a class="link" href="https://letterboxd.com/settings/data/" target="_blank" rel="noopener" data-a="go">Letterboxd ↗</a> (the ZIP as it is).</li>
      <li>Pick the file here.</li></ol>
      <button class="primary" data-a="file">Pick the file</button>
      <small class="hint">Watchlists go on your Personal watchlist. Ratings and diaries mark titles as watched.</small>
      ${saved ? `<button class="link" data-a="saved">Or add the ${saved} titles from your Marquee watchlist</button>` : ""}
      <button data-a="x">Cancel</button></div></div>`);
    document.body.appendChild(bg);
    bg.addEventListener("click", e => { const a = e.target.closest("[data-a]")?.dataset.a; if ((e.target !== bg && !a) || a === "go") return; bg.remove(); if (a === "file") fromFile(); else if (a === "saved") fromSaved(); });
  };
  wlApi = { openImport, addAll };
  view.querySelectorAll("#cwAdd").forEach(b => b.addEventListener("click", () => openSearch("Add to your Personal watchlist", m => addAll([m], m.n))));
  // Imports: IMDb CSV (watchlist or ratings) and Letterboxd (watchlist, ratings, watched or diary CSV, or the whole export ZIP).
  const pool = async (list, fn, label) => {
    const work = list.slice(), out = []; let done = 0, missed = 0;
    const worker = async () => { while (work.length) { const it = work.shift(); try { const m = await fn(it); m ? out.push(m) : missed++; } catch { missed++; } if (++done % 10 === 0) status(`Matching ${label}… ${done} of ${list.length}`); } };
    status(`Matching ${list.length} ${label}…`);
    await Promise.all([worker(), worker(), worker(), worker()]);
    return { out, missed };
  };
  const fromImdbRows = async rows => {
    const head = rows[0].map(h => h.trim().toLowerCase()), ci = head.indexOf("const"), ri = head.indexOf("your rating"), di = head.indexOf("date rated");
    const seen = new Map(), dates = new Map(); for (const r of rows.slice(1)) { const tt = (r[ci] || "").trim(); if (/^tt\d+$/.test(tt) && !seen.has(tt)) { seen.set(tt, ri >= 0 ? Math.round(+r[ri] || 0) / 2 : 0); if (di >= 0 && /^\d{4}-\d\d-\d\d/.test(r[di] || "")) dates.set(tt, r[di].slice(0, 10)); } }
    const { out, missed } = await pool([...seen.keys()], async tt => {
      const f = await M.tm("/find/" + tt, { external_source: "imdb_id" }), mv = (f.movie_results || [])[0], x = mv || (f.tv_results || [])[0];
      return x ? { t: mv ? "movie" : "tv", i: x.id, n: x.title || x.name, y: (x.release_date || x.first_air_date || "").slice(0, 4), p: x.poster_path || "", im: tt, _s: seen.get(tt) || 0, _d: dates.get(tt) || "" } : null;
    }, "IMDb titles");
    // IMDb's watchlist export also has a (mostly empty) "Your Rating" column: only titles you actually rated count as watched.
    const rated = out.filter(m => m._s > 0), want = out.filter(m => !(m._s > 0));
    return { out, rated, want, missed, total: seen.size, seenIt: rated.length > 0, src: rated.length ? "IMDb ratings" : "IMDb watchlist" };
  };
  const fromLbRows = async (rows, kind) => {
    const head = rows[0].map(h => h.trim().toLowerCase()), ni = head.indexOf("name"), yi = head.indexOf("year"), ri = head.indexOf("rating"), di = head.indexOf("watched date") >= 0 ? head.indexOf("watched date") : head.indexOf("date"), realDate = head.includes("watched date");
    const seenIt = kind === "seen" || ri >= 0, films = new Map();
    for (const r of rows.slice(1)) { const n = (r[ni] || "").trim(); if (!n) continue; const k = n + "|" + (r[yi] || ""); const sc = ri >= 0 ? Math.round((+r[ri] || 0) * 2) / 2 : 0; const d = di >= 0 && /^\d{4}-\d\d-\d\d/.test(r[di] || "") ? r[di].slice(0, 10) : ""; if (!films.has(k) || sc) films.set(k, { n, y: (r[yi] || "").trim(), s: sc, d }); }
    const { out, missed } = await pool([...films.values()], async f => {
      // Only accept the same title (or original title) from the same year, give or take one: a loose first search hit
      // used to turn an obscure film into a popular new one with a similar name (e.g. "Clay" became "Clayface").
      const want = seenKey(f.n), yr = +f.y || 0;
      const fits = x => (seenKey(x.title) === want || seenKey(x.original_title) === want) && (!yr || Math.abs((+(x.release_date || "").slice(0, 4) || yr) - yr) <= 1);
      let j = await M.tm("/search/movie", { query: f.n, ...(yr ? { year: yr } : {}) }), x = (j.results || []).find(fits);
      if (!x && yr) { j = await M.tm("/search/movie", { query: f.n }); x = (j.results || []).find(fits); }
      return x ? { t: "movie", i: x.id, n: x.title, y: (x.release_date || "").slice(0, 4), p: x.poster_path || "", _s: Math.max(0, Math.min(5, f.s)), _d: f.d, _w: realDate } : null;
    }, "Letterboxd films");
    return { out, missed, total: films.size, seenIt, src: seenIt ? "Letterboxd" : "Letterboxd watchlist" };
  };
  const report = (r) => status(`${r.out.length} of ${r.total} ${r.src} titles found${r.missed ? ` (${r.missed} couldn't be matched)` : ""}.`);
  $("wlFile")?.addEventListener("change", async e => {
    const file = e.target.files[0]; if (!file) return; e.target.value = "";
    try {
      if (/\.zip$/i.test(file.name) || file.type.includes("zip")) {
        status("Opening the Letterboxd export…");
        if (!window.JSZip) await new Promise((ok, no) => { const sc = document.createElement("script"); sc.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"; sc.onload = ok; sc.onerror = no; document.head.appendChild(sc); });
        const zip = await window.JSZip.loadAsync(file), read = async n => { const f = zip.file(n); return f ? parseCsv(await f.async("string")) : null; };
        const wl = await read("watchlist.csv"), rated = await read("ratings.csv"), watched = await read("watched.csv"), diary = await read("diary.csv");
        if (!wl && !rated && !watched) { status("That ZIP doesn't look like a Letterboxd export."); return; }
        const msg = [];
        if (wl && wl.length > 1) { const r = await fromLbRows(wl, "want"); addAll(r.out, "From their Letterboxd watchlist"); msg.push(`${r.out.length} of ${r.total} watchlist films found.`); }
        // ratings carry stars; watched adds the films seen without a rating
        const seenRows = rated && rated.length > 1 ? rated : null, extra = watched && watched.length > 1 ? watched : null;
        if (seenRows || extra) {
          const r1 = seenRows ? await fromLbRows(seenRows, "seen") : { out: [], missed: 0, total: 0 };
          const r2 = extra ? await fromLbRows(extra, "seen") : { out: [], missed: 0, total: 0 };
          // The diary is the only file with real watch dates ("Watched Date"); use the latest one per film.
          const r3 = diary && diary.length > 1 ? await fromLbRows(diary, "seen") : { out: [] }, dd = new Map();
          for (const m of r3.out) if (m._d && (!dd.has(key(m)) || m._d > dd.get(key(m)))) dd.set(key(m), m._d);
          const have = new Set(r1.out.map(key)), all = [...r1.out, ...r2.out.filter(m => !have.has(key(m)))].map(m => dd.has(key(m)) ? { ...m, _d: dd.get(key(m)), _w: true } : { ...m, _d: "" });
          // A new export replaces the old Letterboxd import (fixes earlier wrong matches); IMDb imports and in-app logs stay.
          { const c = active(), map = evs(c.id); let n = 0; for (const [i, e] of Object.entries(map)) if (!e.gone && e.a === me.id && e.k === "saw" && e.imp && !e.m?.im) { map[i] = { ...e, gone: "relb" + now() }; n++; } if (n) save(c.id); }
          addAll(all, "From their Letterboxd films", true);
          msg.push(`${all.length} films marked as watched.`);
        }
        status(msg.join(" "));
        return;
      }
      const rows = parseCsv(await file.text()); const head = (rows[0] || []).map(h => h.trim().toLowerCase());
      let r;
      if (head.includes("const")) r = await fromImdbRows(rows);
      else if (head.includes("letterboxd uri") || (head.includes("name") && head.includes("year"))) r = await fromLbRows(rows, /watched|diary|ratings/i.test(file.name) ? "seen" : "want");
      else { status("That file isn't an IMDb or Letterboxd export I recognise."); return; }
      report(r);
      if (r.rated) { if (r.rated.length) addAll(r.rated, "From their IMDb ratings", true); if (r.want.length) addAll(r.want, "From their IMDb watchlist"); }
      else addAll(r.out, `From their ${r.src}`, r.seenIt);
    } catch (x) { console.error(x); status("Couldn't read that file. Try exporting it again."); }
  });
  view.querySelectorAll("input.wlQ").forEach(q => q.addEventListener("input", e => { wlQs[e.target.id.slice(4)] = e.target.value.toLowerCase(); keepInputs(renderClub); }));
  cineEl.querySelectorAll("[data-cnv]").forEach(x => x.onclick = () => { cinePane = x.dataset.cnv; render(); });
  view.querySelectorAll("[data-mwv]").forEach(x => x.onclick = () => { mwPane = x.dataset.mwv; render(); });
  view.querySelectorAll("[data-pops]").forEach(x => x.onclick = () => { popSort = x.dataset.pops; render(); });
  view.querySelectorAll("[data-popt]").forEach(x => x.onclick = () => { if (popType === x.dataset.popt) return; popType = x.dataset.popt; popList = null; render(); });
  view.querySelectorAll("[data-cpv]").forEach(x => x.onclick = () => { clubPane = x.dataset.cpv; LS.set("marqueeClubPane", clubPane); render(); });
  view.querySelectorAll("[data-lsv]").forEach(x => x.onclick = () => { lsPane = x.dataset.lsv; LS.set("marqueeLsPane", lsPane); wlAll = false; render(); });
  view.querySelectorAll("[data-wlf]").forEach(x => x.onclick = () => { const id = x.dataset.wlf; if (id === "*") wlFriends.clear(); else wlFriends.has(id) ? wlFriends.delete(id) : wlFriends.add(id); LS.set("marqueeWlFriends", [...wlFriends]); wlAll = false; render(); });
  view.querySelectorAll("details.g-sec").forEach(d => d.addEventListener("toggle", () => { d.open ? genreShut.delete(d.dataset.g) : genreShut.add(d.dataset.g); }));
  $("wlStream")?.addEventListener("click", () => { if (!myServices().size) { M.toast("Pick your streaming services in Settings first."); M.setView("settings"); return; } wlStream = !wlStream; render(); });
  view.querySelectorAll("[data-wldrop]").forEach(b => b.onclick = () => { const w = s.wl.get(b.dataset.wldrop); if (w) act("wldrop", { m: w.m }); });
  view.querySelectorAll("[data-sug]").forEach(b => b.onclick = () => openTitleByKey(s, b.dataset.sug, true));
  document.querySelectorAll("#clubView [data-open], #cineView [data-open]").forEach(b => b.onclick = e => { if (e.target.closest("a, [data-wldrop], [data-saw]")) return; openTitleByKey(s, b.dataset.open); });
}

// ---------- face-off ----------
const vsSeen = new Set();
function faceoff(a, b, myVote) {
  const side = (x, cls) => `<div class="fo-side ${cls}">${poster(x.m.p, "w185")}<b>${esc(x.m.n)}</b><small>${x.votes} vote${x.votes === 1 ? "" : "s"}</small>${seenTag(x.m.n)}
    <button class="vote${myVote === key(x.m) ? " on" : ""}" data-vote="${esc(key(x.m))}">${myVote === key(x.m) ? "✓ Voted" : "Vote"}</button></div>`;
  return `<div class="faceoff">${side(a, "l")}<div class="fo-vs"><span>VS</span></div>${side(b, "r")}</div>`;
}

// ---------- history ----------
let wrapData = null, myWrapData = null, wrapPane = "me", ldPane = LS.get("marqueeLdPane", "board");
// The wrap-up as a 1080×1350 image (posters + stats), shared with the phone's share sheet or downloaded.
async function shareWrap(kind) {
  const w = kind === "me" ? myWrapData : wrapData; if (!w) return;
  const c = document.createElement("canvas"); c.width = 1080; c.height = 1350; const g = c.getContext("2d");
  g.fillStyle = "#ffd400"; g.fillRect(0, 0, 1080, 1350);
  const load = p => new Promise(ok => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => ok(i); i.onerror = () => ok(null); i.src = M.IMG + "w342" + p; });
  const imgs = await Promise.all(w.posters.slice(0, 10).map(load));
  // Posters fit a fixed band (y 300–860) so they never run into the stats below.
  const n = imgs.length, rowsN = n > 4 ? 2 : 1, cols = Math.max(1, Math.ceil(n / rowsN)), gap = 18, y0 = 300, H = 560;
  const ph = Math.min(rowsN === 1 ? 420 : (H - gap) / 2, ((940 - (cols - 1) * gap) / cols) * 1.5), pw = ph / 1.5;
  const x0 = (1080 - cols * pw - (cols - 1) * gap) / 2, yT = y0 + (H - (rowsN * ph + (rowsN - 1) * gap)) / 2;
  imgs.forEach((im, i) => { const x = x0 + (i % cols) * (pw + gap), y = yT + Math.floor(i / cols) * (ph + gap); g.fillStyle = "#111"; g.fillRect(x + 6, y + 6, pw, ph); if (im) g.drawImage(im, x, y, pw, ph); else { g.fillStyle = "#333"; g.fillRect(x, y, pw, ph); } });
  g.fillStyle = "#111"; g.textAlign = "left";
  g.font = "900 44px Impact, 'Arial Black', sans-serif"; g.fillText(w.name.toUpperCase(), 70, 110);
  g.fillStyle = "#e2231a"; g.font = "900 140px Impact, 'Arial Black', sans-serif"; g.fillText(String(w.yr), 70, 250);
  g.fillStyle = "#111"; g.font = "800 40px system-ui, sans-serif"; g.fillText("WRAPPED", 430, 240);
  const line = (label, val, y) => { g.font = "700 28px system-ui, sans-serif"; g.fillStyle = "#5a4a00"; g.fillText(label.toUpperCase(), 70, y); g.font = "800 40px system-ui, sans-serif"; g.fillStyle = "#111"; g.fillText(val.length > 34 ? val.slice(0, 33) + "…" : val, 70, y + 46); };
  let y = y0 + H + 50;
  for (const [l, v] of w.lines.slice(0, 4)) { line(l, v, y); y += 100; }
  let blob; try { blob = await new Promise(ok => c.toBlob(ok, "image/png")); } catch { blob = null; }
  if (!blob) { M.toast("Couldn't make the image."); return; }
  const file = new File([blob], `marquee-${w.yr}.png`, { type: "image/png" });
  if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], title: `${w.name} ${w.yr}` }); return; } catch {} }
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = file.name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
// ---------- Leaderboard: every category the club's own data can rank, per year ----------
let ldYear = new Date().getFullYear(), ldOpen = new Set(), lastWrapHtml = "";
// Past cinema outings (shown at the bottom of At the cinema).
function pastOutingsHtml(s) {
  const today = iso(new Date());
  const past = [...s.outs.values()].filter(o => o.sc?.d && o.sc.d < today && o.ins.size).sort((a, b) => b.sc.d.localeCompare(a.sc.d));
  return past.length ? `<div class="past-outs"><h4 class="wl-sec">Past outings</h4>${past.map(o => `<div class="out-i" data-open="${esc(key(o.m))}">${poster(o.m.p, "w92")}<div class="body"><b>${esc(o.m.n)}</b><span class="ticket-line">🎟 ${esc(scLabel(o.sc))}</span><span class="whos">${[...o.ins.values()].map(n => `<span class="who ok">${esc(n)}</span>`).join("")}</span></div></div>`).join("")}</div>` : "";
}
function leadersHtml(s) {
  const ids = [...s.members.keys()], nm = id => id === me.id ? "You" : s.members.get(id)?.name || "Someone";
  const inYr = d => d && +String(d).slice(0, 4) === ldYear, yrOf = t => new Date(t).getFullYear();
  const W = {}; for (const id of ids) W[id] = myWatched(s, id).filter(w => inYr(w.d));
  const years = new Set([new Date().getFullYear()]);
  for (const id of ids) myWatched(s, id).forEach(w => years.add(+w.d.slice(0, 4)));
  s.sugs.forEach(g => years.add(yrOf(g.at))); for (const o of s.outs.values()) if (o.sc?.d) years.add(+o.sc.d.slice(0, 4));
  // Ratings and reviews given this year (any "Watched" with stars or text, dated by watch day or tap day).
  const rated = {}, reviews = {};
  for (const [sk, mp] of Object.entries(s.saw)) for (const [id, x] of mp) {
    if (!x.v) continue; const when = x.imp ? watchedOn(x) : x.d || iso(new Date(x.at || 0)); if (!inYr(when)) continue; // imported ratings have no real date: they don't count

    if (x.s) (rated[id] ||= []).push(x.s); if (x.x) reviews[id] = (reviews[id] || 0) + 1;
  }
  const sugY = s.sugs.filter(g => yrOf(g.at) === ldYear);
  const landed = {}, speed = {}, accepted = {};
  for (const g of sugY) for (const id of sugTo(s, g)) {
    const at = sawAt(s, g.m, id); if (at && at >= g.at) { landed[g.a] = (landed[g.a] || 0) + 1; (speed[id] ||= []).push((at - g.at) / 864e5); }
    if (accAt(s, g, id)) accepted[id] = (accepted[id] || 0) + 1;
  }
  const outsY = [...s.outs.values()].filter(o => inYr(o.sc?.d) || (!o.sc?.d && yrOf(o.at) === ldYear));
  const went = {}, organised = {}, spots = {};
  for (const o of outsY) { if (o.sc?.d && o.sc.d <= iso(new Date())) for (const id of o.ins.keys()) went[id] = (went[id] || 0) + 1; organised[o.a] = (organised[o.a] || 0) + 1; }
  const talk = {}; for (const list of Object.values(s.talk)) for (const e of list) if (yrOf(e.t) === ldYear) talk[e.a] = (talk[e.a] || 0) + 1;
  const wlNow = {}; for (const w of s.wl.values()) for (const id of w.adders.keys()) wlNow[id] = (wlNow[id] || 0) + 1;
  const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
  const bestMonth = id => { const c = {}; W[id].forEach(w => c[w.d.slice(0, 7)] = (c[w.d.slice(0, 7)] || 0) + 1); const top = Object.entries(c).sort((a, b) => b[1] - a[1])[0]; return top ? { v: top[1], note: new Date(top[0] + "-15").toLocaleDateString(undefined, { month: "long" }) } : null; };
  const bestWeek = id => { const days = [...new Set(W[id].map(w => w.d))].sort(); let best = 0; for (const d of days) best = Math.max(best, W[id].filter(w => w.d >= d && w.d <= isoAdd(d, 6)).length); return best; };
  const streak = id => { const wk = new Set(W[id].map(w => { const x = new Date(w.d + "T12:00"); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return iso(x); })); let best = 0; for (const w of wk) { let n = 1, d = w; while (wk.has(isoAdd(d, 7))) { n++; d = isoAdd(d, 7); } best = Math.max(best, n); } return best; };
  const uniq = id => new Set(W[id].map(w => w.sk)).size;
  // Your own wrap-up for the chosen year (only what you logged in Marquee, like every year stat).
  const myWrap = (() => {
    const Wm = W[me.id] || []; if (!Wm.length) { myWrapData = null; return `<p class="hint">Nothing logged for ${ldYear} yet. Tap Watched? on a title and your wrap-up fills itself.</p>`; }
    const films = Wm.filter(w => !isTv(w.m)).length, series = Wm.length - films;
    const fav = [...Wm].filter(w => w.s).sort((a, b) => b.s - a.s || b.d.localeCompare(a.d))[0];
    const gc = {}; for (const w of Wm) { const g = genreOf(w.m); if (g && g !== "Other") gc[g] = (gc[g] || 0) + 1; } const genre = Object.entries(gc).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (Wm.some(w => !genreCache[key(w.m)])) setTimeout(() => fillGenres(Wm.map(w => ({ m: w.m }))), 0);
    const bm = bestMonth(me.id), st = streak(me.id), revN = reviews[me.id] || 0, outN = went[me.id] || 0, sent = sugY.filter(g => g.a === me.id).length, land = landed[me.id] || 0;
    const tiles = [["Watched", String(Wm.length), films && series ? `${films} films · ${series} series` : ""], fav && ["Favourite", fav.m.n, starStr(fav.s)], genre && ["Top genre", genre, ""],
      bm && ["Busiest month", bm.note, `${bm.v} watched`], st > 1 && ["Longest streak", `${st} weeks`, "in a row"], revN && ["Reviews", String(revN), ""],
      outN && ["Cinema outings", String(outN), ""], sent && ["Suggestions", String(sent), land ? `${land} got watched` : ""], (() => { let best = null; for (const [sk, r] of Object.entries(s.rw)) { const o = r.get(me.id), t = titleBySk(s, sk); if (o && t && (!best || o.n > best.n)) best = { n: o.n, t }; } return best && ["Most rewatched", best.t.n, `${best.n + 1}× watched`]; })(), (n => n && ["List badges", `🏅 ${n}`, "whole lists seen"])(allLists(s).filter(l => listProg(s, l).done).length)].filter(Boolean);
    myWrapData = { yr: ldYear, name: me.name, posters: [...new Set(Wm.map(w => w.m.p).filter(Boolean))].slice(0, 10), lines: tiles.filter(t => t[0] !== "Watched").slice(0, 3).map(([l, v, i]) => [l, i && l !== "Cinema outings" ? `${v} · ${i}` : v]) };
    myWrapData.lines.unshift(["Watched", `${Wm.length} title${Wm.length === 1 ? "" : "s"}${films && series ? ` (${films} films, ${series} series)` : ""}`]);
    return `<div class="wrapup"><div class="wrap-grid">${tiles.map(([l, v, i]) => `<div><small>${esc(l)}</small><b>${esc(v)}</b>${i ? `<i>${esc(i)}</i>` : ""}</div>`).join("")}</div><button class="primary" data-wrapshare="me">Share as an Instagram post</button></div>`;
  })();
  const cats = [
    { e: "🏆", g: "w", t: "Most watched", d: "Films and series seasons logged as just watched", v: id => W[id].length, u: "watched" },
    { e: "🎬", g: "w", t: "Film buff", d: "Most films", v: id => W[id].filter(w => !isTv(w.m)).length, u: "films" },
    { e: "📺", g: "w", t: "Binge king", d: "Most series seasons", v: id => W[id].filter(w => isTv(w.m)).reduce((n, w) => n + (w.ss?.length || 1), 0), u: "seasons" },
    { e: "🔥", g: "w", t: "Longest streak", d: "Weeks in a row with something watched", v: streak, u: "weeks" },
    { e: "⚡", g: "w", t: "Busiest week", d: "Most watched in any 7 days", v: bestWeek, u: "in a week" },
    { e: "📅", g: "w", t: "Best month", d: "Most watched in one month", v: id => bestMonth(id)?.v || 0, note: id => bestMonth(id)?.note, u: "" },
    { e: "✍️", g: "r", t: "Critic of the year", d: "Most reviews written", v: id => reviews[id] || 0, u: "reviews" },
    { e: "⭐", g: "r", t: "Star giver", d: "Most ratings given", v: id => (rated[id] || []).length, u: "ratings" },
    { e: "😇", g: "r", t: "Softie", d: "Highest average rating (3+ ratings)", v: id => (rated[id] || []).length >= 3 ? +avg(rated[id]).toFixed(2) : 0, fmt: v => v.toFixed(1) + " ★" },
    { e: "😈", g: "r", t: "Harshest critic", d: "Lowest average rating (3+ ratings)", v: id => (rated[id] || []).length >= 3 ? +avg(rated[id]).toFixed(2) : 0, low: true, fmt: v => v.toFixed(1) + " ★" },
    { e: "🎯", g: "s", t: "Best taste", d: "Their suggestions that friends then watched", v: id => landed[id] || 0, u: "landed" },
    { e: "📣", g: "s", t: "Top recommender", d: "Suggestions sent", v: id => sugY.filter(g => g.a === id).length, u: "sent" },
    { e: "👍", g: "s", t: "Yes person", d: "Suggestions accepted", v: id => accepted[id] || 0, u: "accepted" },
    { e: "🏃", g: "s", t: "Quickest to watch", d: "Fastest average from suggestion to watched (2+)", v: id => (speed[id] || []).length >= 2 ? +avg(speed[id]).toFixed(1) : 0, low: true, fmt: v => v < 1 ? "same day" : `${v.toFixed(1)} days` },
    { e: "🍿", g: "c", t: "Cinema regular", d: "Cinema outings joined", v: id => went[id] || 0, u: "outings" },
    { e: "🗓️", g: "c", t: "Organiser", d: "Cinema outings suggested", v: id => organised[id] || 0, u: "suggested" },
    { e: "💬", g: "c", t: "Chatterbox", d: "Comments on titles", v: id => talk[id] || 0, u: "comments" },
    { e: "📚", g: "w", t: "Watchlist hoarder", d: "Titles on their watchlist right now", v: id => wlNow[id] || 0, u: "titles" },
    { e: "🌍", g: "w", t: "Explorer", d: "Different titles watched", v: uniq, u: "titles" },
  ];
  const wins = {}; // badge = first place in a category (shared on a tie)
  const done = [], open = [];
  cats.forEach(c => {
    const rows = ids.map(id => ({ id, v: c.v(id) })).filter(r => r.v > 0).sort((a, b) => c.low ? a.v - b.v : b.v - a.v);
    if (!rows.length) { open.push(c); return; }
    const val = r => c.fmt ? c.fmt(r.v) : `${r.v}${c.u ? " " + (r.v === 1 && c.u.endsWith("s") ? c.u.slice(0, -1) : c.u) : ""}${c.note?.(r.id) ? ` · ${c.note(r.id)}` : ""}`;
    let rank = 0, prev = null;
    const ranked = rows.map((r, i) => { if (r.v !== prev) { rank = i + 1; prev = r.v; } return { ...r, rank }; });
    for (const r of ranked) if (r.rank === 1) (wins[r.id] ||= []).push(c.e);
    const top = ranked.filter(r => r.rank === 1), mine = ranked.find(r => r.id === me.id);
    done.push({ c, html: `<details class="ld-row${top.some(r => r.id === me.id) ? " lead-me" : ""}"><summary><span class="ld-e">${c.e}</span><span class="ld-t"><b>${esc(c.t)}</b><small>🥇 ${esc(top.map(r => nm(r.id)).join(", "))} · ${esc(val(top[0]))}${mine && mine.rank > 1 ? ` · you're #${mine.rank}` : ""}</small></span></summary>
      <small class="hint">${esc(c.d)}</small><ol class="ld-list">${ranked.map(r => `<li class="r${r.rank}${r.id === me.id ? " me" : ""}"><span class="ld-r">${["🥇", "🥈", "🥉"][r.rank - 1] || r.rank}</span><span class="ld-n">${esc(nm(r.id))}</span><span class="ld-v">${esc(val(r))}</span></li>`).join("")}</ol></details>` });
  });
  const yrs = [...years].filter(y => y > 1990).sort((a, b) => b - a);
  // Standings: badges (first places) with each person's current streak and next milestone, in one card.
  const standings = (() => {
    const mon = d => { const x = new Date(d + "T12:00"); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return iso(x); };
    const MS = [10, 25, 50, 100, 250, 500, 1000];
    const who = ids.filter(id => !id.startsWith("demo_") || hasDemo(active().id));
    const rows = who.map(id => { const wk = new Set(myWatched(s, id).map(w => mon(w.d))); let d = mon(iso(new Date())); if (!wk.has(d)) d = isoAdd(d, -7); let cur = 0; while (wk.has(d)) { cur++; d = isoAdd(d, -7); }
      let logged = 0; for (const [sk, mp] of Object.entries(s.saw)) { const x = mp.get(id); if (x?.v) logged += 1 + (s.rw[sk]?.get(id)?.n || 0); }
      const ms = [...MS].reverse().find(n => logged >= n) || 0, next = MS.find(n => n > logged);
      return { id, b: wins[id] || [], cur, ms, next, logged, n: W[id]?.length || 0 }; })
      .filter(r => r.b.length || r.cur || r.ms || r.n).sort((a, b) => b.b.length - a.b.length || b.n - a.n || b.cur - a.cur);
    if (!rows.length) return `<p class="hint">Nobody has logged anything for ${ldYear} yet. Tap Watched? on a title to get on the board.</p>`;
    let rank = 0, prev = -1;
    return `<ol class="ld-stand">${rows.map((r, i) => { if (r.b.length !== prev) { rank = i + 1; prev = r.b.length; }
      return `<li class="r${rank}${r.id === me.id ? " me" : ""}"><span class="ld-r">${["🥇", "🥈", "🥉"][rank - 1] || rank}</span>
        <span class="ld-n"><b>${esc(nm(r.id))}</b><small>${r.n} watched in ${ldYear}${r.cur ? ` · 🔥 ${r.cur} week${r.cur === 1 ? "" : "s"} in a row` : ""}${r.ms ? ` · 🎯 ${r.ms}+` : ""}${r.next ? ` · ${r.next - r.logged} to ${r.next}` : ""}</small>${r.b.length ? `<small class="ld-bd">${r.b.join(" ")}</small>` : ""}</span>
        <span class="ld-v"><b>${r.b.length}</b><small>badge${r.b.length === 1 ? "" : "s"}</small></span></li>`; }).join("")}</ol>
      <small class="hint">A badge for every category you lead. Prizes at the end of the year.</small>`;
  })();
  const G = [["w", "🎬 Watching"], ["r", "⭐ Ratings & reviews"], ["s", "📣 Suggestions"], ["c", "🍿 Cinema & chat"]];
  const board = `<div class="fr-card"><h4 class="ld-sec">Standings</h4>${standings}</div>
    <div class="ld-cols">${G.map(([g, l]) => { const rs = done.filter(x => x.c.g === g); return rs.length ? `<div class="fr-card ld-group"><h4 class="ld-sec">${l}</h4>${rs.map(x => x.html).join("")}</div>` : ""; }).join("")}</div>
    ${open.length ? `<div class="fr-card ld-open"><h4 class="ld-sec">Still up for grabs</h4><div class="ld-free">${open.map(c => `<span title="${esc(c.d)}">${c.e} ${esc(c.t)}</span>`).join("")}</div><small class="hint">Nobody has scored in these yet in ${ldYear}. First one in takes the badge.</small></div>` : ""}`;
  const wrap = `<div class="fr-card"><div class="wl-views">${[["me", "Me"], ["club", esc(s.name || "The club")]].map(([k, l]) => `<button class="chip${wrapPane === k ? " on" : ""}" data-wrapv="${k}">${l}</button>`).join("")}</div>
      ${wrapPane === "me" ? myWrap : lastWrapHtml}</div>`;
  return `<div class="fr-card ld-top"><div class="ld-years">${yrs.map(y => `<button class="chip${y === ldYear ? " on" : ""}" data-ldy="${y}">${y}</button>`).join("")}</div>
    ${pulpPick([["board", `${esc(s.name || "Movie club")} · ${ldYear}`, "Leaderboard"], ["wrap", String(ldYear), "Wrap-up"]], ldPane, "data-ldp")}</div>
    ${ldPane === "wrap" ? wrap : board}`;
}
function bindLeaders() {
  lead.querySelectorAll("[data-wrapshare]").forEach(b => b.onclick = () => shareWrap(b.dataset.wrapshare));
  lead.querySelectorAll("[data-ldp]").forEach(b => b.onclick = () => { ldPane = b.dataset.ldp; LS.set("marqueeLdPane", ldPane); lead.innerHTML = leadersHtml(lastState); bindLeaders(); });
  lead.querySelectorAll("[data-wrapv]").forEach(b => b.onclick = () => { wrapPane = b.dataset.wrapv; lead.innerHTML = leadersHtml(lastState); bindLeaders(); });
  lead.querySelectorAll("[data-ldy]").forEach(b => b.onclick = () => { ldYear = +b.dataset.ldy; historyHtml(lastState); lead.innerHTML = leadersHtml(lastState); bindLeaders(); });
}
// History: everything the club has watched (newest first) with stars and reviews, plus past cinema outings.
function historyHtml(s) {
  const items = [];
  for (const [sk, mp] of Object.entries(s.saw)) {
    const who = [...mp.entries()].filter(([, x]) => x.v); if (!who.length) continue;
    const m = titleBySk(s, sk); if (!m) continue;
    const sc = who.map(([, x]) => x.s).filter(Boolean);
    items.push({ m, sk, who, last: Math.max(...who.map(([, x]) => x.at || 0)), avg: sc.length ? sc.reduce((a, b) => a + b, 0) / sc.length : 0 });
  }
  items.sort((a, b) => b.last - a.last);
  const today = iso(new Date());
  const past = [...s.outs.values()].filter(o => o.sc?.d && o.sc.d < today && o.ins.size).sort((a, b) => b.sc.d.localeCompare(a.sc.d));
  const reviews = items.reduce((n, it) => n + it.who.filter(([, x]) => x.x || x.s).length, 0);
  const best = items.filter(it => it.avg).sort((a, b) => b.avg - a.avg)[0];
  const head = `<div class="fr-card pulp">
    <div class="pulp-head"><span class="chapter">${esc(s.name || "Movie club")}</span><h2 class="bang">Watched</h2></div>
    <div class="hstats"><div><b>${items.length}</b><small>title${items.length === 1 ? "" : "s"}</small></div><div><b>${reviews}</b><small>review${reviews === 1 ? "" : "s"}</small></div><div><b>${past.length}</b><small>outing${past.length === 1 ? "" : "s"}</small></div></div>
    ${best ? `<small class="hint">Club favourite: <b>${esc(best.m.n)}</b> · ${best.avg.toFixed(1)} ★</small>` : ""}
  </div>`;
  const card = it => `<div class="fr-card hcard"><div class="hrow" data-open="${esc(key(it.m))}">${poster(it.m.p, "w154")}<div class="body">
      <b class="t">${esc(it.m.n)}${it.m.y ? ` <small class="hint">(${esc(it.m.y)})</small>` : ""}${isTv(it.m) ? ` <span class="tv-tag">Series</span>` : ""}</b>
      ${it.avg ? `<span class="stars">${starStr(it.avg)}</span><small class="hint">${it.avg.toFixed(1)} from ${it.who.filter(([, x]) => x.s).length}</small>` : ""}
      <div class="hrev">${it.who.map(([id, x]) => `<p><b>${esc(id === me.id ? "You" : x.name)}</b>${x.s ? ` <span class="stars">${starStr(x.s, true)}</span>` : ""}${x.x ? ` ${esc(x.x)}` : ""}</p>`).join("")}</div>
    </div></div></div>`;
  const yr = ldYear;
  const yItems = items.map(it => ({ ...it, who: it.who.filter(([, x]) => +watchedOn(x).slice(0, 4) === yr) })).filter(it => it.who.length);
  const wrap = yItems.length ? (() => {
    const most = [...yItems].sort((a, b) => b.who.length - a.who.length || b.last - a.last)[0];
    const rated = yItems.map(it => { const sc = it.who.map(([, x]) => x.s).filter(Boolean); return { it, avg: sc.length ? sc.reduce((a, b) => a + b, 0) / sc.length : 0 }; }).filter(x => x.avg).sort((a, b) => b.avg - a.avg)[0];
    const rev = {}; for (const it of yItems) for (const [id, x] of it.who) if (x.s || x.x) rev[id] = { n: x.name, c: (rev[id]?.c || 0) + 1 };
    const top = Object.entries(rev).sort((a, b) => b[1].c - a[1].c)[0];
    const outs = past.filter(o => o.sc.d >= `${yr}-01-01`).length;
    wrapData = { yr, name: s.name || "Movie club", posters: [...new Set(yItems.map(it => it.m.p).filter(Boolean))].slice(0, 10), lines: [
      ["Watched together", `${yItems.length} titles · ${outs} cinema outing${outs === 1 ? "" : "s"}`], ["Most watched", most.m.n],
      ...(rated ? [["Best rated", `${rated.it.m.n} · ${rated.avg.toFixed(1)} ★`]] : []), ...(top ? [["Top reviewer", `${top[0] === me.id ? me.name : top[1].n} · ${top[1].c} review${top[1].c === 1 ? "" : "s"}`]] : [])] };
    return `<div class="wrapup"><div class="wrap-grid">
      <div><small>Watched</small><b>${yItems.length}</b></div><div><small>Outings</small><b>${outs}</b></div>
      <div><small>Most watched</small><b>${esc(most.m.n)}</b><i>${most.who.length} of you</i></div>
      ${rated ? `<div><small>Best rated</small><b>${esc(rated.it.m.n)}</b><i>${rated.avg.toFixed(1)} ★</i></div>` : ""}
      ${top ? `<div><small>Top reviewer</small><b>${esc(top[0] === me.id ? "You" : top[1].n)}</b><i>${top[1].c} review${top[1].c === 1 ? "" : "s"}</i></div>` : ""}
    </div><button class="primary" data-wrapshare="club">Share as an Instagram post</button></div>`;
  })() : `<p class="hint">Nothing watched by the club in ${yr} yet.</p>`;
  lastWrapHtml = wrap;
  return head
    + (items.length ? items.map(card).join("") : `<div class="fr-card"><p class="hint">Nothing watched yet. When someone taps Watched? on a title, it lands here with their stars and review.</p></div>`)
    + (past.length ? `<div class="fr-card"><h3>Past outings</h3>${past.map(o => `<div class="out-i">${poster(o.m.p, "w92")}<div class="body"><b>${esc(o.m.n)}</b><span class="ticket-line">🎟 ${esc(scLabel(o.sc))}</span><span class="whos">${[...o.ins.values()].map(n => `<span class="who ok">${esc(n)}</span>`).join("")}</span></div></div>`).join("")}</div>` : "");
}

// The club page is split into tabs so nothing needs a long scroll on a phone.
let clubTab = (() => { let t = "weekly"; try { t = sessionStorage.getItem("marqueeClubTab") || "weekly"; } catch {} return { week: "weekly", vote: "weekly", cine: "weekly", cal: "weekly", monthly: "weekly", set: "weekly" }[t] || t; })();
function setClubTab(t) { clubTab = t; try { sessionStorage.setItem("marqueeClubTab", t); } catch {} view.dataset.tab = t; view.querySelectorAll("[data-ct]").forEach(b => b.setAttribute("aria-selected", b.dataset.ct === t)); $("cbGear")?.classList.toggle("on", t === "set"); window.scrollTo({ top: 0 }); }
function renderClub() {
  const c = active(), s = derive(c.id); lastState = s;
  if (s.name !== c.name || s.day !== c.day) { const l = clubs(); const x = l.find(y => y.id === c.id); x.name = s.name || x.name; x.day = s.day; LS.set("marqueeClubs", l); }
  const cur = s.cur, movie = s.picks[cur], rd = s.round(cur), cands = tallyW(s, rd);
  const myVote = rd.votes.get(me.id) || "";
  const totalVotes = cands.reduce((a, x) => a + x.votes, 0);
  const members = [...s.members.entries()];
  const night = movie ? nightAfter(movie.at, s.day) : null;
  const seenMine = movie ? rd.seen.get(me.id) : null;
  const scores = movie ? [...rd.seen.values()].map(x => x.s).filter(Boolean) : [];
  const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  const locked = movie && !seenMine && !peek[cur];
  const past = Object.keys(s.picks).map(Number).filter(r => r < cur).sort((a, b) => b - a);
  const vs = cands.length >= 2, vsKey = vs ? `${c.id}:${cur}:${key(cands[0].m)}:${key(cands[1].m)}` : "";
  const vsStill = !vs || vsSeen.has(vsKey) || !!myVote;
  if (vs) vsSeen.add(vsKey);
  const calH = calEvents(s, "home"), calC = calEvents(s, "cine");
  const cineDot = outings(s).some(o => !o.ins.has(me.id) && o.at > (s.members.get(me.id)?.last || 0) - 864e5 * 7);
  view.dataset.tab = clubTab;

  view.innerHTML = `
    <div class="fr-card">
      <div class="fr-row club-top"><div class="club-id"><h2 class="club-logo" aria-label="${esc(s.name || c.name)}"><span class="cl-badge" aria-hidden="true"><svg viewBox="0 0 48 48" width="38" height="38"><path d="M9 22a5 5 0 0 1 5-5h20a5 5 0 0 1 5 5v3H9z" fill="#ffd400" stroke="#111" stroke-width="2.5" stroke-linejoin="round"/><path d="M5 25a4 4 0 0 1 8 0v4h22v-4a4 4 0 0 1 8 0v11H5z" fill="#ffd400" stroke="#111" stroke-width="2.5" stroke-linejoin="round"/><path d="M9 36v4M39 36v4" stroke="#111" stroke-width="3" stroke-linecap="round"/><path d="M24 17v12" stroke="#111" stroke-width="2"/></svg></span><span class="cl-t">${esc(s.name || c.name)}</span></h2><div class="faces" title="${esc(members.map(([, m]) => m.name).join(", "))}">${members.map(([id, m]) => avatar(m.name, movie && rd.seen.has(id))).join("")}</div></div>
        <button id="cbInvite">Invite</button></div>
      <p class="hint" id="clubOffline"${online ? " hidden" : ""}>Can't reach the club right now. What you do is saved here and sent when you're back online.</p>
    </div>
    <div class="club-tabs" role="tablist">${[["mine", "My wall", sugForMe(s).some(g => sugNew(s, g) || sugDueToday(g))], ["lists", "Lists", false], ["weekly", "The Club", false]]
      .map(([k, l, dot]) => `<button role="tab" data-ct="${k}" aria-selected="${clubTab === k}"${dot ? ' class="dot"' : ""}>${l}</button>`).join("")}</div>
    <div class="ccol c0">    ${(() => { const nNew = sugForMe(s).filter(g => !accAt(s, g, me.id)).length, nW = myWatched(s, me.id).filter(w => +w.d.slice(0, 4) === new Date().getFullYear()).length;
      if (mwPane === "pop") mwPane = "list";
      return `<div class="fr-card" data-tab="mine">${pulpPick([["list", `${nW} in ${new Date().getFullYear()}`, "Watched"], ["old", (n => `${n} title${n === 1 ? "" : "s"}`)(seenBefore(s).length), "Seen before"], ["fy", nNew ? `${nNew} new` : "Suggestions", "For you", nNew]], mwPane, "data-mwv", true)}
      ${mwPane === "fy" ? forYouCard(s) : mwPane === "old" ? `<div id="wlCardOld">${seenBeforeCard(s)}</div>` : myWatchedCard(s)}</div>`; })()}
    </div><div class="ccol c1">
    ${(() => { const nb = allLists(s).filter(l => listProg(s, l).done).length, nl = allLists(s).length;
      return `<div class="fr-card" data-tab="lists">${pulpPick([["mine", `${myWlCount(s)} to watch`, "Personal watchlist"], ["lists", nb ? `🏅 ${nb} badge${nb === 1 ? "" : "s"}` : `${nl} list${nl === 1 ? "" : "s"}`, "Lists"]], lsPane, "data-lsv")}
      <input type="file" id="wlFile" accept=".csv,.zip,text/csv,application/zip" hidden>
      ${lsPane === "lists" ? `<div id="listsView"></div>` : wlCard(s, cands, lsPane)}</div>`; })()}
    </div><div class="ccol c2">
    ${(() => { const nf = [...s.wl.values()].filter(w => [...w.adders.keys()].some(id => id !== me.id) && !sawIt(s, w.m) && !Object.values(s.picks).some(p => key(p) === key(w.m))).length;
      return `<div class="fr-card" data-tab="weekly">${pulpPick([["club", `${nf} title${nf === 1 ? "" : "s"}`, "Club list"], ["pop", "This week", "Popular"]], clubPane, "data-cpv")}
      ${clubPane === "pop" ? popHtml(s) : wlCard(s, cands, "club")}</div>`; })()}
    </div>



    </div>`;

  { const sc = $("setClub"); if (sc) sc.innerHTML = `    <div class="set-club">
      <details class="more" open><summary>Club settings: ${esc(s.name || c.name)}</summary>
        <div style="display:flex;flex-direction:column;gap:10px;margin-top:10px">
          <label>Your name <input type="text" id="cbMe" maxlength="40" value="${esc(me.name)}"></label>
          <label>Club name <input type="text" id="cbRename" maxlength="40" value="${esc(s.name || c.name)}"></label>
          <button id="cbSaveSet">Save</button>
          <button id="cbNew">Start or join another club</button>
          <small class="hint">Your other clubs are under My clubs below.</small>
          <details class="more cb-data"><summary>Club data</summary><div style="display:flex;flex-direction:column;gap:10px;margin-top:10px">
            ${hasDemo(c.id) ? `<button id="cbDemoOff">Remove test friends</button>` : ""}
            ${LS.get("marqueeLastReset_" + c.id, "") ? `<button id="cbUndoReset">Undo the reset</button>` : `<button id="cbReset">Reset to just after my list imports</button>`}
            <button class="link" id="cbLeave">Leave this club</button></div></details>
        </div>
      </details>
    </div>`; }
  if (cineEl) { const n = outings(s).length; cineEl.innerHTML = `<div class="fr-card cine-card"><div class="wl-pick" role="tablist">${[["cal", "In Ghent", "Calendar"], ["out", n ? `${n} planned` : "Cinema night", "Next outings"]].map(([k, ch, l], i) => `<button class="pulp-head${i ? " alt" : ""}${cinePane === k ? " on" : ""}" data-cnv="${k}" role="tab" aria-selected="${cinePane === k}"><span class="chapter">${ch}</span><span class="bang">${l}</span></button>`).join("")}</div>
      ${cinePane === "cal" ? `<div id="cbCal">${calHtml(s, calC, "cine")}</div>` : cinemaCard(s, members) + pastOutingsHtml(s)}</div>`; }
  { const cb = $("cineBadge"); if (cb) cb.hidden = !cineDot; }
  hist.innerHTML = historyHtml(s);
  if (lead) { lead.innerHTML = leadersHtml(s); bindLeaders(); }
  renderLists(s);
  bind(c, s, cands, movie);
  bindCinema(s);
  bindCal(s, calH, "home"); bindCal(s, calC, "cine");
  bindWl(s, cands);
  setTimeout(() => scheduleDigest(s, c), 0);
  $("mwLog")?.addEventListener("click", () => openSearch("What did you watch?", m => openReview(derive(active().id), seenKey(m.n), m, { log: true })));
  $("sbAdd")?.addEventListener("click", () => openSearch("What have you seen before?", m => openReview(derive(active().id), seenKey(m.n), m, { old: true })));
  document.querySelectorAll("[data-sbs]").forEach(b => b.onclick = () => { sbSort = b.dataset.sbs; LS.set("marqueeSbSort", sbSort); renderClub(); });
  document.querySelectorAll("[data-sbt]").forEach(b => b.onclick = () => { sbType = b.dataset.sbt; renderClub(); });
  $("sbQ")?.addEventListener("input", e => { sbQ = e.target.value.toLowerCase(); keepInputs(renderClub); });
  document.querySelectorAll("[data-mww]").forEach(b => b.onclick = () => { mwWho = b.dataset.mww; LS.set("marqueeMwWho", mwWho === "*" ? "*" : ""); mwAll = false; renderClub(); });
  document.getElementById("mwDiary")?.addEventListener("click", () => { mwDiary = !mwDiary; LS.set("marqueeMwDiary", mwDiary); renderClub(); });
  document.querySelectorAll("[data-mwy]").forEach(b => b.onclick = () => { mwYear = +b.dataset.mwy; mwAll = false; renderClub(); });
}

function bind(c, s, cands, movie) {
  const cur = s.cur;
  view.querySelectorAll("[data-ct]").forEach(b => b.onclick = () => setClubTab(b.dataset.ct));
  $("cbInvite").onclick = () => shareInvite({ ...c, name: s.name || c.name, day: s.day });
  $("cbFirst")?.addEventListener("click", () => openSearch("Choose the first film or series", m => act("pick", { r: 0, m }, { title: `First movie: ${m.n}`, body: `Watch it before ${nightLabel(nightAfter(now(), s.day))}.` })));
  calNominate = (initial = "") => openSearch(movie ? "Nominate what to watch next" : "Nominate the first movie", m => {
    const rd = s.round(cur);
    if (tally(rd).some(x => key(x.m) === key(m))) { M.toast(`${m.n} is already nominated.`); return; }
    act("nom", { m }, { title: `${me.name} nominated ${m.n}`, body: "Open the club to vote." });
    if (!s.round(cur).votes.get(me.id)) setTimeout(() => act("vote", { v: key(m) }), 50);
  }, initial);
  $("cbNom")?.addEventListener("click", () => calNominate());
  $("cbAskVote")?.addEventListener("click", () => {
    const list = cands.map(x => `• ${x.m.n} (${x.votes})`).join("\n");
    shareText(`Vote on the club watchlist for ${movie ? "our next" : "our first"} pick:\n${list}\nVote here:`, APP_URL + "?view=club");
  });
  $("cbLock")?.addEventListener("click", () => {
    const w = cands[0];
    if (!confirm(`Lock in ${w.m.n} as ${movie ? "the next" : "the first"} pick to watch at home?`)) return;
    act("pick", { r: cur + 1, m: w.m }, { title: `Next movie: ${w.m.n}`, body: `${w.votes} vote${w.votes === 1 ? "" : "s"}. Watch it before ${nightLabel(nightAfter(now(), s.day))}.` });
  });
  view.querySelectorAll("[data-vote]").forEach(b => b.onclick = () => act("vote", { v: s.round(cur).votes.get(me.id) === b.dataset.vote ? "" : b.dataset.vote }));
  view.querySelectorAll("[data-drop]").forEach(b => b.onclick = () => { const x = cands.find(y => key(y.m) === b.dataset.drop); if (x) act("drop", { m: x.m }); });
  $("cbPost")?.addEventListener("click", () => M.open(movie.t, movie.i, movie.n));
  $("cbShare")?.addEventListener("click", () => shareText(`Now watching in ${s.name || "our movie club"}: ${movie.n}${movie.y ? ` (${movie.y})` : ""}. Watch it before ${nightLabel(nightAfter(movie.at, s.day))}, then tell us what you thought:`, APP_URL + "?view=club"));
  $("cbPeek")?.addEventListener("click", () => { peek[cur] = true; render(); });
  $("cbUnsee")?.addEventListener("click", () => openSeen(s, movie));
  $("cbSeen")?.addEventListener("click", () => openSeen(s, movie));
  const sendSay = r => {
    const i = $("say_" + r), x = i.value.trim(); if (!x) return;
    i.value = "";
    const m = s.picks[r];
    act("say", { r, x }, { title: `${me.name} on ${m?.n || "the movie"}`, body: x.slice(0, 200) });
  };
  document.querySelectorAll("#clubView [data-say], #histView [data-say]").forEach(b => b.onclick = () => sendSay(+b.dataset.say));
  document.querySelectorAll("#clubView .say input, #histView .say input").forEach(i => i.addEventListener("keydown", e => { if (e.key === "Enter" && !e.isComposing) sendSay(+i.id.slice(4)); }));
  hist.querySelectorAll("[data-open]").forEach(b => b.onclick = e => { if (e.target.closest("a, [data-saw]")) return; openTitleByKey(s, b.dataset.open); });
  hist.querySelectorAll("details[data-past]").forEach(d => d.addEventListener("toggle", () => { const r = +d.dataset.past; d.open ? openPast.add(r) : openPast.delete(r); }));
  $("cbDemo")?.addEventListener("click", addDemo);
  $("revRead")?.addEventListener("click", () => { LS.set(revReadKey(c.id), now()); render(); });
  view.querySelectorAll("[data-demo]").forEach(b => b.onclick = () => { b.disabled = true; addDemo(); });
  $("cbDemoOff")?.addEventListener("click", removeDemo);
  $("cbReset")?.addEventListener("click", () => { if (confirm("Go back to right after your IMDb/Letterboxd imports? Test friends and everything you did after the imports (ratings, logs, suggestions, single adds) is removed. You can undo it.")) resetToImports(); });
  $("cbUndoReset")?.addEventListener("click", undoReset);
  $("cbSaveSet").onclick = () => {
    const n = $("cbMe").value.trim(), cn = $("cbRename").value.trim(), day = s.day;
    if (n && n !== me.name) ensureMe(n.slice(0, 40));
    if ((cn && cn !== s.name) || day !== s.day) act("meta", { name: cn || s.name, day });
    else render();
    M.toast("Saved.");
  };
  $("cbNew").onclick = () => { showStart = true; M.setView("club"); render(); };
  $("cbLeave").onclick = () => {
    if (!confirm(`Remove ${s.name || c.name} from this device? You can rejoin with the invite link.`)) return;
    leaveClub(c.id);
  };
}

// Marking something as seen asks for a quick score and review; whoever suggested it to you gets told.
function titleBySk(s, sk) {
  const all = [...[...s.wl.values()].map(w => w.m), ...s.sugs.map(g => g.m), ...[...s.outs.values()].map(o => o.m), ...Object.values(s.picks), ...Object.values(s.mon).flatMap(mo => [mo.pick, ...mo.noms.map(n => n.m)]).filter(Boolean)];
  return all.find(m => seenKey(m.n) === sk) || [...(s.saw[sk]?.values() || [])].find(x => x.m)?.m || null;
}
// My watched list: the date I watched it (picked in the review sheet), else the day I tapped Watched. Bulk imports without a date don't count.
// Only what you log in Marquee counts per year. Imported titles count only if you switch on "Letterboxd diary dates" (and the diary has a date).
let mwDiary = LS.get("marqueeMwDiary", false);
const watchedOn = x => x.old ? "" : x.imp ? (mwDiary && x.wd) || "" : x.d || iso(new Date(x.at || 0));
// How much two members agree: films both rated, 100% = same stars every time (needs 3+ films in common).
function agreeOf(s, a, b) {
  const ds = []; for (const [sk, mp] of Object.entries(s.saw)) { const x = mp.get(a), y = mp.get(b); if (x?.v && y?.v && x.s && y.s) ds.push({ sk, d: Math.abs(x.s - y.s), a: x.s, b: y.s }); }
  if (ds.length < 3) return null;
  const pct = Math.round(100 * (1 - ds.reduce((t, x) => t + x.d, 0) / ds.length / 4.5)), split = [...ds].sort((p, q) => q.d - p.d)[0];
  return { pct, n: ds.length, split: split.d >= 1.5 ? split : null };
}
// Weekly digest: every device queues (and refreshes) one shared notification for Sunday 19:00 with the club's week in film.
function scheduleDigest(s, c) {
  if (!window.MarqueePush || !c || hasDemo(c.id)) return;
  const k = "marqueeDigestAt_" + c.id; if (now() - LS.get(k, 0) < 3 * 3600e3) return;
  const t = new Date(), monD = new Date(t); monD.setDate(t.getDate() - ((t.getDay() + 6) % 7)); const mon = iso(monD);
  const sun = new Date(monD); sun.setDate(monD.getDate() + 6); sun.setHours(19, 0, 0, 0); if (t > sun) return;
  const ids = [...s.members.keys()].filter(id => !id.startsWith("demo_"));
  const wk = ids.flatMap(id => myWatched(s, id).filter(w => w.d >= mon).map(w => ({ ...w, id })));
  LS.set(k, now()); if (!wk.length || ids.length < 2) return;
  const nmOf = id => s.members.get(id)?.name || "Someone", per = {}; for (const w of wk) per[w.id] = (per[w.id] || 0) + 1;
  const top = [...wk].filter(w => w.s >= 4).sort((a, b) => b.s - a.s)[0], busy = Object.entries(per).sort((a, b) => b[1] - a[1])[0];
  const sugN = s.sugs.filter(g => g.d >= mon).length;
  const body = [`The club watched ${wk.length} title${wk.length === 1 ? "" : "s"} this week.`, top && `${nmOf(top.id)} loved ${top.m.n} (${starStr(top.s, true)}).`, busy && Object.keys(per).length > 1 && `${nmOf(busy[0])} watched the most (${busy[1]}).`, sugN && `${sugN} new suggestion${sugN === 1 ? "" : "s"}.`].filter(Boolean).join(" ").slice(0, 290);
  window.MarqueePush.send({ id: ("dig_" + c.id + "_" + mon).replace(/[^\w]/g, "").slice(0, 60), to: ids, at: sun.getTime(), title: `${s.name || "Movie club"}: your week in film`, body });
}
function myWatched(s, who = me.id) {
  const out = [];
  for (const [sk, mp] of Object.entries(s.saw)) { const x = mp.get(who); if (!x?.v) continue; const m = titleBySk(s, sk) || x.m; if (!m) continue;
    const ss = ssList(x.ss);
    if (ss.length) { const byDay = {}; for (const n of ss) if (x.ss[n]) (byDay[x.ss[n]] ||= []).push(n); for (const [d, ns] of Object.entries(byDay)) { const rs = ns.map(n => x.sr?.[n]).filter(Boolean); out.push({ sk, m, d, s: rs.length ? Math.round(rs.reduce((a, b) => a + b, 0) / rs.length * 2) / 2 : x.s, x: x.x, ss: ns }); } continue; }
    const rw = s.rw[sk]?.get(who);
    if (rw) rw.past.forEach((p, i) => out.push({ sk, m, d: p.d, s: p.s, x: p.x, rw: i }));
    const d = watchedOn(x); if (d) out.push({ sk, m, d, s: x.s, x: x.x, rw: rw?.n || 0 }); }
  return out.sort((a, b) => b.d.localeCompare(a.d));
}
// Seen before: everything you marked as watched without a date ("Seen it before" and list imports), A–Z.
function seenBefore(s) {
  const out = [], seenK = new Set();
  for (const [sk, mp] of Object.entries(s.saw)) { const x = mp.get(me.id); if (!x?.v) continue; const m = x.m || titleBySk(s, sk); if (!m || seenK.has(key(m))) continue; seenK.add(key(m)); out.push({ m, s: x.s, x: x.x, d: x.imp ? "" : x.d || (x.old ? "" : iso(new Date(x.at || 0))), ss: ssList(x.ss), at: x.at || 0 }); } // everything you've seen: logged with a date, seen before, or imported
  for (const mp of Object.values(s.sawAlt)) { const x = mp.get(me.id); if (x?.v && !seenK.has(key(x.m))) { seenK.add(key(x.m)); out.push({ m: x.m, s: x.s, x: x.x, d: x.d || (x.old ? "" : iso(new Date(x.at || 0))), ss: [], at: x.at || 0 }); } }
  return out.sort((a, b) => a.m.n.localeCompare(b.m.n));
}
let sbQ = "", sbSort = LS.get("marqueeSbSort", "az"), sbType = "all";
function seenBeforeCard(s) {
  const all = seenBefore(s), nTv = all.filter(w => isTv(w.m)).length, mixed = nTv && nTv < all.length;
  const list = all.filter(w => (!sbQ || w.m.n.toLowerCase().includes(sbQ)) && (!mixed || sbType === "all" || (sbType === "tv") === isTv(w.m)))
    .sort(sbSort === "year" ? (a, b) => (+b.m.y || 0) - (+a.m.y || 0) || a.m.n.localeCompare(b.m.n) : sbSort === "rate" ? (a, b) => (b.s || 0) - (a.s || 0) || rateOf(b.m) - rateOf(a.m) || a.m.n.localeCompare(b.m.n)
      : sbSort === "recent" ? (a, b) => (b.d || "").localeCompare(a.d || "") || b.at - a.at || a.m.n.localeCompare(b.m.n) : (a, b) => a.m.n.localeCompare(b.m.n));
  if (sbSort === "genre" && all.some(w => !genreCache[key(w.m)])) setTimeout(() => fillGenres(all), 0);
  const groupOf = w => sbSort === "year" ? String(w.m.y || "Unknown year") : sbSort === "rate" ? (w.s ? starStr(w.s, true) : "Not rated by you") : sbSort === "genre" ? genreOf(w.m) || "Loading…"
    : sbSort === "recent" ? (w.d ? new Date(w.d + "T12:00").toLocaleDateString(undefined, { month: "long", year: "numeric" }) : "Seen before, no date") : (/^[a-z]/i.test(w.m.n) ? w.m.n[0].toUpperCase() : "#");
  const row = w => { const dt = w.d ? new Date(w.d + "T12:00") : null;
    return `<div class="mw-i" data-open="${esc(key(w.m))}">${dt ? `<span class="mw-d"><b>${dt.getDate()}</b><small>${esc(dt.toLocaleDateString(undefined, { month: "short" }))}${dt.getFullYear() !== new Date().getFullYear() ? ` ’${String(dt.getFullYear()).slice(2)}` : ""}</small></span>` : ""}${poster(w.m.p, "w92")}<div class="body"><b>${esc(w.m.n)}${w.m.y ? ` <small>${esc(w.m.y)}</small>` : ""}${isTv(w.m) ? ` <span class="tv-tag">${w.ss.length ? esc(ssLabel(w.ss)) : "Series"}</span>` : ""}</b>${w.s ? `<span class="stars">${starStr(w.s)}</span>` : ""}${w.x ? `<small class="hint">“${esc(w.x)}”</small>` : ""}</div></div>`; };
  let last = null; const groups = [];
  for (const w of list) { const g = groupOf(w); if (g !== last) { groups.push([g, []]); last = g; } groups[groups.length - 1][1].push(w); }
  if (sbSort === "genre") { const m = new Map(); for (const [g, ws] of groups) m.set(g, [...(m.get(g) || []), ...ws]); groups.length = 0; groups.push(...[...m].sort((a, b) => (a[0] === "Loading…") - (b[0] === "Loading…") || b[1].length - a[1].length)); }
  const body = `<div class="mw-list sb-list">${groups.map(([g, ws]) => `<h5 class="mw-mo">${esc(g)} <i>${ws.length}</i></h5>${ws.map(row).join("")}`).join("")}</div>`;
  const seg = (attr, opts, cur) => `<div class="seg">${opts.map(([k, l]) => `<button class="${k === cur ? "on" : ""}" ${attr}="${k}">${l}</button>`).join("")}</div>`;
  return `<div id="sbCard"><div class="wl-tools">${all.length > 12 ? `<input type="search" id="sbQ" placeholder="Search" value="${esc(sbQ)}" autocomplete="off">` : ""}<button class="primary" id="sbAdd">+ Log</button></div>
    ${all.length > 1 ? `<div class="wl-filt"><div class="wl-frow">${seg("data-sbs", [["az", "A–Z"], ["recent", "Recent"], ["year", "Year"], ["genre", "Genre"], ["rate", "My ★"]], sbSort)}${mixed ? seg("data-sbt", [["all", "All"], ["movie", "Films"], ["tv", "Series"]], sbType) : ""}</div></div>` : ""}
    <p class="hint mw-sum">${all.length ? `<b>${all.length}</b> title${all.length === 1 ? "" : "s"} you've seen${list.length !== all.length ? ` · ${list.length} shown` : ""}` : `Nothing yet. Everything you mark as watched, or import from IMDb or Letterboxd, lands here.`}</p>
    ${body}</div>`;
}
let mwYear = new Date().getFullYear(), mwAll = false, mwWho = LS.get("marqueeMwWho", "*");
function myWatchedCard(s) {
  const ppl = [...s.members.entries()].filter(([id]) => id !== me.id && myWatched(s, id).length);
  if (mwWho && mwWho !== "*" && !ppl.some(([id]) => id === mwWho)) mwWho = "";
  const wall = mwWho === "*" && ppl.length > 0; // one wall: everyone's watched titles mixed, newest first
  const who = !wall && mwWho && mwWho !== "*" ? mwWho : me.id, whoName = who !== me.id ? s.members.get(who)?.name || "" : "";
  const all = wall ? [...s.members.keys()].flatMap(id => myWatched(s, id).map(w => ({ ...w, who: id }))).sort((a, b) => b.d.localeCompare(a.d) || (b.at || 0) - (a.at || 0)) : myWatched(s, who), years = [...new Set([new Date().getFullYear(), ...all.map(w => +w.d.slice(0, 4))])].sort((a, b) => b - a);
  if (!years.includes(mwYear)) mwYear = years[0];
  const list = all.filter(w => +w.d.slice(0, 4) === mwYear), shown = list;
  const diaryN = Object.values(s.saw).map(mp => mp.get(who)).filter(x => x?.v && x.imp && x.wd && +x.wd.slice(0, 4) === mwYear).length;
  const films = list.filter(w => !isTv(w.m)).length, series = list.length - films;
  let lastMo = "";
  const rows = shown.map(w => {
    const mo = w.d.slice(0, 7), head = mo !== lastMo ? `<h5 class="mw-mo">${esc(new Date(w.d + "T12:00").toLocaleDateString(undefined, { month: "long" }))}</h5>` : ""; lastMo = mo;
    return `${head}<div class="mw-i" data-open="${esc(key(w.m))}"><span class="mw-d"><b>${+w.d.slice(8)}</b><small>${esc(new Date(w.d + "T12:00").toLocaleDateString(undefined, { weekday: "short" }))}</small></span>${poster(w.m.p, "w92")}<div class="body">${w.who ? `<span class="mw-who${w.who === me.id ? " me" : ""}" style="--h:${[...w.who].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7)}">${esc(w.who === me.id ? "You" : s.members.get(w.who)?.name || "?")}</span>` : ""}<b>${esc(w.m.n)}${w.m.y ? ` <small>${esc(w.m.y)}</small>` : ""}${isTv(w.m) ? ` <span class="tv-tag">${w.ss ? esc(ssLabel(w.ss)) : "Series"}</span>` : ""}${w.rw ? ` <span class="rw-tag">↻ ${w.rw === 1 ? "rewatch" : `${w.rw + 1}th watch`}</span>` : ""}</b>${w.s ? `<span class="stars">${starStr(w.s)}</span>` : ""}${w.x ? `<small class="hint">“${esc(w.x)}”</small>` : ""}</div></div>`;
  }).join("");
  return `<div id="mwCard">
    ${ppl.length || !whoName ? `<div class="wl-head">${ppl.length ? `<div class="wl-views">${[["*", "Everyone"], ["", "Me"], ...ppl.map(([id, m]) => [id, m.name])].map(([id, n]) => { const ag = id && id !== "*" ? agreeOf(s, me.id, id) : null; return `<button class="chip${id === mwWho || (id === "" && mwWho === "*" && !wall) ? " on" : ""}" data-mww="${esc(id)}"${ag ? ` title="You agree ${ag.pct}% on ${ag.n} films"` : ""}>${esc(n)}${ag ? ` <i class="ag">${ag.pct}%</i>` : ""}</button>`; }).join("")}</div>` : "<span></span>"}${whoName ? "" : `<button class="primary" id="mwLog">+ Log</button>`}</div>` : ""}
    ${(() => { if (!whoName) return ""; const ag = agreeOf(s, me.id, mwWho); if (!ag) return `<p class="hint mw-ag">🤝 Rate 3 films you've both seen to see how much you and ${esc(whoName)} agree.</p>`;
      const sp = ag.split, sm = sp && titleBySk(s, sp.sk);
      return `<p class="hint mw-ag">🤝 You and ${esc(whoName)} agree <b>${ag.pct}%</b> on ${ag.n} films.${sm ? ` Biggest split: <b>${esc(sm.n)}</b> (you ${starStr(sp.a)}, ${esc(whoName)} ${starStr(sp.b)}).` : ""}</p>`; })()}
    ${years.length > 1 ? `<div class="wl-views">${years.map(y => `<button class="chip${y === mwYear ? " on" : ""}" data-mwy="${y}">${y}</button>`).join("")}</div>` : ""}
    ${!whoName && diaryN ? `<button class="chip${mwDiary ? " on" : ""}" id="mwDiary">${mwDiary ? "✓ " : ""}Include ${diaryN} from my Letterboxd diary</button>` : ""}
    <p class="hint mw-sum">${list.length ? `<b>${list.length}</b> watched in ${mwYear}${wall ? " by the club" : ""}${films && series ? ` · ${films} film${films === 1 ? "" : "s"}, ${series} series` : ""}` : whoName ? `${esc(whoName)} hasn't logged anything for ${mwYear}.` : `Nothing logged for ${mwYear} yet. Tap Watched? on any title, or + Log for something that isn't on a list.`}</p>
    <div class="mw-list">${rows}</div>
  </div>`;
}
function openReview(s, sk, m0, opts = {}) {
  const m = titleBySk(s, sk) || m0 || null, name = m?.n || "it", today = iso(new Date());
  const prev = s.saw[sk]?.get(me.id)?.v ? s.saw[sk].get(me.id) : null, tvish = !!m && isTv(m);
  let score = prev?.s || 0; const picked = new Set(ssList(prev?.ss));
  const bg = el(`<div class="sheet-bg"><div class="sheet" role="dialog" aria-label="Rate it">
    <h3>${prev && !opts.log ? `Update ${esc(name)}` : esc(name)}</h3>
    <div class="rev-btns rev-pick"><button class="primary" data-when="now">Just watched</button><button data-when="old">Seen it before</button></div>
    <p class="rev-mode" hidden><b></b> <button class="link" id="revMode">change</button></p>
    <div class="rev-step2" hidden>
    <div class="mstars">${[1, 2, 3, 4, 5].map(n => `<button data-s="${n}" aria-label="${n} stars">★</button>`).join("")}</div>
    <small class="hint rev-tip">Tap a star twice for a half star.</small>
    <input type="text" id="revX" maxlength="300" placeholder="Quick review (optional)" enterkeyhint="done" value="${esc(prev?.x || "")}">
    ${tvish ? `<div class="rev-ss"><small class="hint">Seasons you've watched</small><div class="ss-grid"><small class="hint">Loading seasons…</small></div></div>` : ""}
    <label class="rev-d">Watched on <input type="date" id="revD" value="${opts.log ? today : prev?.d || today}" max="${today}"></label>
    ${prev && !tvish ? `<small class="hint rev-rw"${opts.log || prev.old ? "" : " hidden"}>↻ You've logged this before, so this counts as a rewatch. Your earlier watch stays on your wall.</small>` : ""}
    ${m && s.members.size > 1 && !prev ? `<div class="rev-rec"><small class="hint">Recommend it to your friends?</small><div class="wl-views rec-to"><button class="chip${opts.rec ? "" : " on"}" data-rec="">No</button><button class="chip${opts.rec ? " on" : ""}" data-rec="*">All friends</button>${[...s.members.entries()].filter(([id]) => id !== me.id).map(([id, x]) => `<button class="chip" data-rec="${esc(id)}">${esc(x.name)}</button>`).join("")}</div></div>` : ""}
    <button class="primary" id="revSave">Save</button></div>${prev && !opts.log && !tvish ? `<button class="link" id="revAgain">↻ I watched it again</button>` : ""}${prev ? `<button class="link" id="revUn">Mark as not watched</button>` : ""}</div></div>`);
  document.body.appendChild(bg);
  if (tvish) M.tm(`/tv/${m.i}`).then(j => {
    const list = (j.seasons || []).map(x => x.season_number).filter(n => n > 0);
    const n = list.length ? list : Array.from({ length: j.number_of_seasons || 0 }, (_, i) => i + 1);
    const grid = bg.querySelector(".ss-grid"); if (!grid) return;
    grid.innerHTML = n.length ? n.map(k => `<button class="ss${picked.has(k) ? " on" : ""}" data-ss="${k}">S${k}</button>`).join("") + (n.length > 1 ? `<button class="link" data-ssall>all</button>` : "") : `<small class="hint">No season list for this one.</small>`;
    grid.querySelectorAll("[data-ss]").forEach(b => b.onclick = () => { const k = +b.dataset.ss; picked.has(k) ? picked.delete(k) : picked.add(k); b.classList.toggle("on", picked.has(k)); });
    grid.querySelector("[data-ssall]")?.addEventListener("click", () => { n.forEach(k => picked.add(k)); grid.querySelectorAll("[data-ss]").forEach(b => b.classList.add("on")); });
  }).catch(() => { const g = bg.querySelector(".ss-grid"); if (g) g.innerHTML = `<small class="hint">Couldn't load the seasons.</small>`; });
  // Step 1: when did you watch it? Step 2 (stars, review, seasons, recommend) only shows after that choice.
  let old = false, again = !!opts.log; const recTo = new Set(opts.rec ? ["*"] : []);
  bg.querySelectorAll("[data-rec]").forEach(b => b.onclick = () => { const id = b.dataset.rec;
    if (!id) recTo.clear(); else if (id === "*") { recTo.clear(); recTo.add("*"); } else { recTo.delete("*"); recTo.has(id) ? recTo.delete(id) : recTo.add(id); }
    bg.querySelectorAll("[data-rec]").forEach(c => c.classList.toggle("on", c.dataset.rec === "" ? !recTo.size : recTo.has(c.dataset.rec))); });
  const step = o => {
    old = o; bg.querySelector(".rev-pick").hidden = true; bg.querySelector(".rev-step2").hidden = false;
    const md = bg.querySelector(".rev-mode"); md.hidden = false; md.querySelector("b").textContent = old ? "Seen it before" : "Just watched";
    bg.querySelector(".rev-d").hidden = old; const rwl = bg.querySelector(".rev-rw"); if (rwl) rwl.hidden = old || !(again || prev?.old); bg.querySelector(".rev-tip").hidden = !!score;
    setTimeout(() => bg.querySelector(".mstars button")?.focus(), 50);
  };
  bg.querySelectorAll("[data-when]").forEach(b => b.onclick = () => step(b.dataset.when === "old"));
  bg.querySelector("#revMode").onclick = () => { bg.querySelector(".rev-pick").hidden = false; bg.querySelector(".rev-step2").hidden = true; bg.querySelector(".rev-mode").hidden = true; };
  bg.querySelector("#revSave").onclick = () => save(true);
  bg.querySelector("#revAgain")?.addEventListener("click", e => { again = true; e.currentTarget.remove(); bg.querySelector("h3").textContent = name; bg.querySelector("#revD").value = today; bg.querySelector("#revX").value = ""; score = 0; paintStars(bg, 0); step(false); });
  if (prev) step(opts.log ? false : !!prev.old); else if (opts.old) step(true);
  bg.querySelector("#revUn")?.addEventListener("click", () => { bg.remove(); act("saw", { sk, v: 0 }); });
  const save = (withReview) => {
    const x = withReview ? bg.querySelector("#revX").value.trim().slice(0, 300) : "", sc = withReview ? score : 0;
    const rec = recTo.size > 0, d = bg.querySelector("#revD").value || today, rw = !old && !!prev && !tvish && (again || !!prev.old);
    bg.remove();
    const from = prev || old ? [] : s.sugs.filter(g => seenKey(g.m.n) === sk && g.a !== me.id && sugTo(s, g).includes(me.id));
    const ss = {}; for (const k of picked) ss[k] = prev?.ss && k in prev.ss ? prev.ss[k] : old ? "" : d;
    const news = from.length ? { to: [...new Set(from.map(g => g.a))], title: `${me.name} watched ${name}${sc ? " " + starStr(sc, true) : ""}`, body: x || `Your suggestion${from.length > 1 ? "s" : ""} worked.` } : null;
    const sr = {}; for (const k of picked) if (prev?.sr?.[k]) sr[k] = prev.sr[k];
    act("saw", { sk, v: 1, ...(Object.keys(sr).length ? { sr } : {}), ...(rw ? { rw: 1 } : {}), ...(old ? { old: 1 } : { d }), ...(picked.size ? { ss } : {}), ...(sc ? { s: sc } : {}), ...(x ? { x } : {}), ...(m ? { m: { t: m.t, i: m.i, n: m.n, y: m.y, p: m.p } } : {}) }, news);
    // Cancel my "Still on for…?" nudges for this title: an empty recipient list makes the sender drop it.
    for (const g of s.sugs.filter(g => seenKey(g.m.n) === sk && accAt(s, g, me.id))) window.MarqueePush?.send({ to: [], id: `acc_${g.id}_${me.id}`.replace(/[^\w]/g, "").slice(0, 60), title: "-", body: "" });
    // Recommend: it lands in everyone else's For you as a suggestion to accept.
    if (rec && m) {
      const s2 = derive(active().id), all = recTo.has("*"), to = all ? ["*"] : [...recTo];
      const others = (all ? realIds(s2) : to.filter(id => !id.startsWith("demo_"))).filter(id => id !== me.id && !s2.saw[sk]?.get(id)?.v);
      act("sug", { m, to, d: iso(new Date()), wk: 0 }, others.length ? { to: others, title: `${me.name} recommends ${m.n}${sc ? " " + starStr(sc, true) : ""}`, body: x || "Watched it and says you should too." } : null);
      M.toast(`Recommended ${m.n} to ${all ? "all your friends" : to.map(id => s2.members.get(id)?.name).join(", ")}.`);
    }
    if (m && (sc || x) && !old) {
      const t = el(`<div class="post-offer"><span>Saved. Share it on Instagram?</span><button class="primary">Make a post</button><button class="link" aria-label="No thanks">✕</button></div>`);
      document.body.appendChild(t); const bye = () => t.remove(); setTimeout(bye, 9000);
      t.querySelector(".link").onclick = bye;
      t.querySelector(".primary").onclick = () => { bye(); titleSheet?.remove(); M.open(m.t, m.i, m.n, { rating: sc ? sc * 2 : null, take: x }); };
    }
  };
  bg.querySelectorAll(".mstars button").forEach(b => b.onclick = () => { score = halfTap(score, +b.dataset.s); paintStars(bg, score); });
  bg.querySelector("#revX").addEventListener("keydown", e => { if (e.key === "Enter" && !e.isComposing) save(true); });
  bg.addEventListener("click", e => { if (e.target === bg) bg.remove(); });
  if (score) paintStars(bg, score);
}
// Reviews of my suggestions that I haven't looked at yet.
const revReadKey = id => "marqueeRevRead_" + id;
function newReviews(s) {
  const since = LS.get(revReadKey(active().id), 0), out = [];
  for (const g of s.sugs.filter(g => g.a === me.id)) for (const id of sugTo(s, g)) {
    const x = s.saw[seenKey(g.m.n)]?.get(id);
    if (x?.v && x.at > since && x.at > g.at && !out.some(o => o.id === id && o.m.n === g.m.n)) out.push({ id, name: x.name, m: g.m, s: x.s, x: x.x, at: x.at });
  }
  return out.sort((a, b) => b.at - a.at);
}

function openSeen(s, movie) {
  let score = s.round(s.cur).seen.get(me.id)?.s || 0;
  const bg = el(`<div class="sheet-bg"><div class="sheet" role="dialog" aria-label="Rate it">
    <h3>How was ${esc(movie.n)}?</h3>
    <div class="mstars">${[1, 2, 3, 4, 5].map(n => `<button data-s="${n}" class="${n <= score ? "on" : n - .5 === score ? "half" : ""}" aria-label="${n} stars">★</button>`).join("")}</div>
    <input type="text" id="seenSay" maxlength="600" placeholder="First thoughts for the group (optional)">
    <button class="primary" id="seenGo">Done</button><button id="seenCancel">Cancel</button></div></div>`);
  document.body.appendChild(bg);
  const close = () => bg.remove();
  bg.addEventListener("click", e => { if (e.target === bg) close(); });
  bg.querySelector("#seenCancel").onclick = close;
  bg.querySelectorAll(".mstars button").forEach(b => b.onclick = () => { score = halfTap(score, +b.dataset.s); paintStars(bg, score); });
  bg.querySelector("#seenGo").onclick = async () => {
    const x = bg.querySelector("#seenSay").value.trim(); close();
    await act("seen", { s: score });
    if (x) act("say", { x }, { title: `${me.name} on ${movie.n}`, body: x.slice(0, 200) });
  };
}

// ---------- start ----------
async function refresh() { const c = active(); if (!me || !c) return; const fresh = await pull(c.id); if (fresh.length) render(); }
render();
live();
refresh();
loadCine(); loadKp();
// Take back one of my own suggestions (For you › You suggested, and the title sheet).
document.addEventListener("click", e => {
  const b = e.target.closest("[data-sugdrop]"); if (!b || !lastState) return;
  e.stopPropagation(); const ids = b.dataset.sugdrop.split(","), gs = lastState.sugs.filter(x => ids.includes(x.id)), g = gs[0]; if (!g) return;
  if (g.a !== me.id) { actMany(gs.map(x => ["sugdrop", { sg: x.id }]), null); M.toast(`Removed ${g.m.n} from your suggestions.`); return; } // only hides it for me
  act("sugdrop", { sg: g.id }); M.toast(`Took back your suggestion of ${g.m.n}.`);
  if (titleSheet && b.closest(".title-sheet")) { titleSheet.remove(); setTimeout(() => openTitle(derive(active().id), g.m), 60); }
}, true);
// Accept buttons (For you rows and the title sheet).
document.addEventListener("click", e => {
  const b = e.target.closest("[data-acc]"); if (!b || !lastState) return;
  e.stopPropagation(); const g = lastState.sugs.find(x => x.id === b.dataset.acc); if (!g) return;
  acceptSug(lastState, g); if (titleSheet && b.closest(".title-sheet")) { titleSheet.remove(); setTimeout(() => openTitle(derive(active().id), g.m), 60); }
}, true);
// One tap handler for every "Seen it?" tag, wherever it is drawn.
document.addEventListener("click", e => {
  const b = e.target.closest("[data-saw]"); if (!b || !lastState) return;
  e.stopPropagation();
  const mine = !!lastState.saw[b.dataset.saw]?.get(me.id)?.v;
  if (mine && !isTv(titleBySk(lastState, b.dataset.saw) || {})) act("saw", { sk: b.dataset.saw, v: 0 }); else openReview(lastState, b.dataset.saw);
}, true);
// Quietly keep the other clubs topped up too.
clubs().filter(c => c.id !== active()?.id).forEach(c => pull(c.id));
setInterval(() => { if (document.visibilityState === "visible") refresh(); }, 120000);
document.addEventListener("visibilitychange", () => { live(); if (document.visibilityState === "visible") refresh(); });
// The account sync wrote newer data (another device's clubs, list, history): fold it in and redraw.
addEventListener("marquee-synced", e => {
  const keys = e.detail || [];
  if (keys.includes("marqueeClubMe")) me = LS.get("marqueeClubMe", me);
  if (keys.includes("marqueeClubActive") || !active()) activeId = LS.get("marqueeClubActive", activeId);
  for (const k of keys) if (k.startsWith("marqueeClubEv_")) { foldIn(store[k.slice(evKey("").length)] ||= {}, LS.get(k, {})); }
  live(); render();
});
$("nav").addEventListener("click", e => { if (e.target.closest("[data-view=club], [data-view=cine]")) { markRead(); render(); } });
