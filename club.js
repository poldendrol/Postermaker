// Movie club: a group watches one movie a week, votes on the next one and talks about it.
// No accounts and no server of our own. Every action is a small "event" that is saved on this
// device and sent to the club's private ntfy.sh topic, so everyone's copy fills in. ntfy keeps
// messages for about 12 hours, so whoever opens the club re-sends recent events the topic is
// missing. That way the club's state survives as long as any member still has it.
const M = window.Marquee;
const $ = id => document.getElementById(id);
const view = $("clubView"), hist = $("histView"), lead = $("leadView"), mwView = $("mwView");
const APP_URL = location.origin + location.pathname;
const NTFY = window.MARQUEE_NTFY || "https://ntfy.sh";
const TAG = "mqc1:";
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

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
const monthName = r => new Date(Math.floor(r / 12), r % 12, 1, 12).toLocaleDateString(undefined, { month: "long" });
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
const clubs = () => LS.get("marqueeClubs", []);           // [{ id, name, day }]
let activeId = LS.get("marqueeClubActive", null);
const evKey = id => "marqueeClubEv_" + id;
const store = {};                                         // club id -> { event id: event }
const evs = id => (store[id] ||= LS.get(evKey(id), {}));
const save = id => LS.set(evKey(id), store[id] || {});
const active = () => clubs().find(c => c.id === activeId) || clubs()[0] || null;

function addClub(c) {
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
const KINDS = new Set(["meta", "join", "nom", "drop", "vote", "pick", "unpick", "say", "seen", "go", "saw", "wl", "wldrop", "sug", "in", "odate", "ospot", "acc", "sugdrop"]);
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
    if (e.k === "ospot") { e.ok = String(e.ok || "").slice(0, 200); e.x = String(e.x || "").slice(0, 80); }
    if (e.k === "saw") {
      if (e.d && !/^\d{4}-\d\d-\d\d$/.test(e.d)) delete e.d; if (e.imp) e.imp = 1; if (e.old) e.old = 1;
      if (e.ss) { const o = {}; if (typeof e.ss === "object") for (const [n, d] of Object.entries(e.ss).slice(0, 60)) if (+n > 0 && +n < 100 && (d === "" || /^\d{4}-\d\d-\d\d$/.test(d))) o[+n] = d; e.ss = o; }
    }
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
  const E = Object.values(evs(clubId)).sort((x, y) => x.t - y.t || (x.i < y.i ? -1 : 1));
  const club = clubs().find(c => c.id === clubId) || {};
  const s = { name: club.name, day: club.day ?? 0, members: new Map(), picks: {}, cur: -1, rounds: {}, mon: {}, saw: {}, wl: new Map(), sugs: [], talk: {}, outs: new Map(), acc: {} };
  const R = r => (s.rounds[r] ||= { noms: [], dropped: new Set(), votes: new Map(), seen: new Map(), says: [] });
  const unpickAt = {};
  for (const e of E) if (e.k === "unpick" && e.tr !== "m") unpickAt[e.r] = Math.max(unpickAt[e.r] || 0, e.t);
  for (const e of E) {
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
      case "sug": if (e.m && e.d) s.sugs.push({ id: e.i, m: e.m, a: e.a, by: e.n || "Someone", to: e.to, d: e.d, wk: !!e.wk, at: e.t }); break;
      case "sugdrop": if (e.sg) (s.sugDrop ||= new Map()).set(e.sg, e.a); break;
      case "acc": if (e.sg) (s.acc[e.sg] ||= new Map()).set(e.a, { v: !!e.v, at: e.t, name: e.n }); break;
      case "wl": if (e.m) { const k = key(e.m), w = s.wl.get(k) || { m: e.m, adders: new Map(), at: e.t }; w.adders.set(e.a, e.n || "Someone"); s.wl.set(k, w); } break;
      case "wldrop": if (e.m) s.wl.get(key(e.m))?.adders.delete(e.a); break;
      case "saw": if (e.sk) (s.saw[e.sk] ||= new Map()).set(e.a, { v: !!e.v, name: e.n, at: e.t, s: e.v ? Math.max(0, Math.min(5, Math.round((+e.s || 0) * 2) / 2)) : 0, x: e.v ? e.x || "" : "", d: e.v ? e.d || "" : "", imp: !!e.imp, old: !!e.old, m: e.m || s.saw[e.sk].get(e.a)?.m || null, ss: e.v ? e.ss || null : null }); break;
    }
  }
  for (const [k, w] of s.wl) if (!w.adders.size) s.wl.delete(k);
  if (s.sugDrop) s.sugs = s.sugs.filter(g => s.sugDrop.get(g.id) !== g.a); // only the one who suggested it can take it back
  const rs = Object.keys(s.picks).map(Number);
  s.cur = rs.length ? Math.max(...rs) : -1;
  s.round = r => R(r);
  return s;
}
function tallyM(mo) {
  if (!mo) return [];
  const noms = mo.noms.filter(n => !mo.dropped.has(ckey(n)));
  const count = {}; for (const v of mo.votes.values()) if (v) count[v] = (count[v] || 0) + 1;
  return noms.map((n, idx) => ({ ...n, votes: count[ckey(n)] || 0, idx })).sort((a, b) => b.votes - a.votes || a.idx - b.idx);
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
  const all = Object.values(evs(clubId));
  const latestMeta = all.filter(e => e.k === "meta").sort((a, b) => b.t - a.t)[0];
  const want = all.filter(e => e === latestMeta || e.k === "pick" || e.k === "unpick" || e.k === "wl" || e.k === "wldrop" || e.k === "saw" || e.k === "sug" || e.k === "sugdrop" || e.k === "acc" || e.k === "in" || e.k === "odate" || e.k === "ospot" || (e.tr === "m" && (e.k === "nom" || e.k === "drop")) || (e.k === "say" && e.sk) || (e.k !== "meta" && e.r >= keepFrom));
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
    if (news) { post({ topic: newsTopic(c.id), title: `${s.name || "Movie club"}: ${news.title}`, message: news.body || "Tap to open the club.", click: APP_URL + "?view=club", tags: ["clapper"] }).catch(() => {}); pushNews(s, news); }
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
    if (news) { post({ topic: newsTopic(c.id), title: `${s.name || "Movie club"}: ${news.title}`, message: news.body || "Tap to open the club.", click: APP_URL + "?view=club", tags: ["clapper"] }).catch(() => {}); pushNews(s, news); }
  } catch { M.toast("Saved here. It'll reach the club when you're back online."); }
}

// Push notifications (when Marquee is closed) go through push.js: a queue in Firestore that a GitHub job sends every few minutes.
const realIds = s => [...s.members.keys()].filter(id => id !== me.id && !id.startsWith("demo_"));
function pushNews(s, news) {
  const to = (news.to || realIds(s)).filter(id => id !== me.id && !id.startsWith("demo_"));
  if (!to.length || !window.MarqueePush) return;
  window.MarqueePush.send({ to, title: `${s.name || "Movie club"}: ${news.title}`, body: news.body || "Tap to open the club.", ...(news.at ? { at: news.at } : {}), ...(news.id ? { id: news.id } : {}) });
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
    <input type="search" id="clubQ" placeholder="Search a movie or series" autocomplete="off">
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
        const d = await M.tm("/search/multi", { query: text, include_adult: "false" });
        if (my !== seq) return;
        items = (d.results || []).filter(x => x.media_type === "movie" || x.media_type === "tv").slice(0, 12)
          .map(x => ({ t: x.media_type, i: x.id, n: x.title || x.name, y: (x.release_date || x.first_air_date || "").slice(0, 4), p: x.poster_path || "" }));
        res.innerHTML = items.length ? items.map((m, i) => `<button data-i="${i}">${poster(m.p, "w92")}<span><b>${esc(m.n)}</b><br><small class="hint">${esc(m.y || "")}${m.t === "tv" ? " · series" : ""}</small></span></button>`).join("") : `<p class="hint">Nothing found.</p>`;
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

function chatHtml(s, r, locked) {
  const rd = s.round(r);
  return `<div class="chat${locked ? " hidden-spoilers" : ""}">
    ${rd.says.length ? rd.says.map(e => `<div class="msg${e.a === me.id ? " mine" : ""}">${avatar(e.n)}<div class="bub"><small>${esc(e.n)} · ${when(e.t)}</small><span>${esc(e.x)}</span></div></div>`).join("")
      : `<p class="hint">No thoughts yet. Start the conversation.</p>`}
  </div>`;
}
function sayBox(r) {
  return `<div class="say"><input type="text" id="say_${r}" maxlength="600" placeholder="Share what you thought…" enterkeyhint="send"><button class="primary" data-say="${r}">Send</button></div>`;
}

document.addEventListener("marquee:view", e => { if (e.detail === "settings") renderSettingsExtras(); });
function render() {
  badge(); renderSettingsExtras();
  if (showStart || !me || !clubs().length || pendingInvite && !clubs().some(c => c.id === pendingInvite.id)) {
    renderStart();
    hist.innerHTML = `<div class="fr-card"><h3>No history yet</h3><p class="hint">Start or join a movie club, and every movie the group votes on shows up here.</p><button class="primary" id="hsGo">Go to the club</button></div>`;
    $("hsGo").onclick = () => M.setView("club");
    if (lead) lead.innerHTML = `<div class="fr-card"><h3>No leaderboard yet</h3><p class="hint">Start or join a movie club first. Then everyone's watching, reviews and outings get ranked here.</p></div>`;
    if (mwView) mwView.innerHTML = `<div class="fr-card"><h3>My watched list</h3><p class="hint">Start or join a movie club first, then everything you watch is logged here with its date.</p></div>`;
    return;
  }
  if (pendingInvite) { activeId = pendingInvite.id; LS.set("marqueeClubActive", activeId); pendingInvite = null; }
  keepInputs(renderClub);
}

// ---------- charts ----------
const CHART = ["var(--accent)", "#2f7fd6", "#f2a541", "#2fa36b", "#7a4be0", "#d6487f", "#3fb6c6", "#8a8494"];
function donut(parts, total, label) {
  const R = 54, C = 2 * Math.PI * R; let off = 0;
  const segs = total ? parts.filter(p => p.v).map(p => { const len = p.v / total * C; const seg = `<circle r="${R}" cx="70" cy="70" fill="none" stroke="${p.c}" stroke-width="22" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}"><title>${esc(p.n)}: ${p.v}</title></circle>`; off += len; return seg; }).join("") : "";
  return `<svg class="donut" viewBox="0 0 140 140" role="img" aria-label="${esc(label)}">
    <circle r="${R}" cx="70" cy="70" fill="none" stroke="var(--field)" stroke-width="22"/>
    <g transform="rotate(-90 70 70)">${segs}</g>
    <text x="70" y="68" text-anchor="middle" class="dn">${total}</text><text x="70" y="88" text-anchor="middle" class="dl">${total === 1 ? "vote" : "votes"}</text></svg>`;
}
function voteChart(cands, total, members) {
  const parts = cands.map((x, i) => ({ n: x.m.n, v: x.votes, c: CHART[i % CHART.length] }));
  const pct = v => total ? Math.round(v / total * 100) : 0;
  return `<div class="vchart">${donut(parts, total, "Votes so far")}
    <div class="legend">${parts.map(p => `<div><i style="background:${p.c}"></i><span>${esc(p.n)}</span><b>${pct(p.v)}%</b></div>`).join("")}
      <small class="hint">${total} of ${members} member${members === 1 ? "" : "s"} voted</small></div></div>`;
}
function scoreChart(scores) {
  const counts = [1, 2, 3, 4, 5].map(n => scores.filter(x => x === n).length), max = Math.max(1, ...counts);
  return `<div class="schart" role="img" aria-label="Scores from the group">${counts.map((c, i) => `<div class="col"><span class="v">${c || ""}</span><i style="height:${Math.round(c / max * 100)}%"></i><small>${i + 1}★</small></div>`).join("")}</div>`;
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
let calAll = LS.get("marqueeCalAll", false); // false: the cinema calendar shows outings and Kinepolis releases only
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
const sugTo = (s, g) => g.to.includes("*") ? [...s.members.keys()].filter(id => id !== g.a) : g.to.filter(id => s.members.has(id) || id === me.id);
const sawAt = (s, m, id) => { const x = s.saw[seenKey(m.n)]?.get(id); return x?.v ? x.at || 1 : 0; };
const sugOpen = (s, g, id) => !sawAt(s, g.m, id);
const sugForMe = s => s.sugs.filter(g => g.a !== me.id && sugTo(s, g).includes(me.id) && sugOpen(s, g, me.id)).sort((a, b) => a.d.localeCompare(b.d));
const sugMine = s => s.sugs.filter(g => g.a === me.id && sugTo(s, g).some(id => sugOpen(s, g, id)));
// Suggestions to me that I've already seen stay visible (greyed, with "✓ Seen" to undo a misclick).
const sugForMeSeen = s => s.sugs.filter(g => g.a !== me.id && sugTo(s, g).includes(me.id) && !sugOpen(s, g, me.id)).sort((a, b) => sawAt(s, b.m, me.id) - sawAt(s, a.m, me.id)).slice(0, 10);
const sugSent = s => s.sugs.filter(g => g.a === me.id).sort((a, b) => b.at - a.at).slice(0, 20); // including ones everybody has watched
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
  return `<div class="cal-nav"><button class="link" data-cm="-1" aria-label="Earlier weeks">‹</button><b>${fmt(start)} – ${fmt(end)}</b><button class="link" data-cm="1" aria-label="Later weeks">›</button></div>
    <div class="cal">${["M", "T", "W", "T", "F", "S", "S"].map(x => `<span class="cal-h">${x}</span>`).join("")}${cells}</div>
    <div class="cal-key">${home ? `<span><i class="k cnt">2</i>Reminders</span><span><i class="k past"></i>Watched together</span>` : `<span>🎟 Outing</span><span><i class="k cnt">3</i>${calAll ? "Screenings in Ghent" : "New at Kinepolis"}</span><button class="chip${calAll ? " on" : ""}" id="calAll">All Ghent screenings</button>`}</div>
    <div class="cal-info">${info}${home ? "" : cineHtml(selIso)}</div>`;
}
function bindCal(s, ev, mode) {
  const box = $(mode === "home" ? "cbCalH" : "cbCal"); if (!box) return;
  const st = CAL[mode];
  const redraw = box._redraw = () => { box.innerHTML = calHtml(s, ev, mode); bindCal(s, ev, mode); };
  box.querySelectorAll("[data-cine]").forEach(b => b.onclick = () => { const off = cineOff(), c = b.dataset.cine; off.has(c) ? off.delete(c) : off.add(c); LS.set("marqueeCinemasOff", [...off]); indexCine(); redraw(); });
  box.querySelectorAll("[data-cn]").forEach(b => b.onclick = () => { const x = JSON.parse(b.dataset.cn); pickTime(x, h => cineNominate({ c: x.c, d: x.d, h, u: x.u }, x.t)); });
  box.querySelectorAll("[data-cm]").forEach(b => b.onclick = () => { st.off += +b.dataset.cm; redraw(); });
  box.querySelector("#calAll")?.addEventListener("click", () => { calAll = !calAll; LS.set("marqueeCalAll", calAll); redraw(); });
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
  window.MarqueePush.send({ id: "rem_" + (h >>> 0).toString(36), to, at: at.getTime(), title: `Tomorrow: ${o.m.n}`, body: `${scLabel(o.sc)}${o.spot ? ` · after: ${o.spot}` : ""}. Got your ticket?` });
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
  return `<div class="fr-card pulp cinema" data-tab="monthly">
    <div class="pulp-head mon"><span class="chapter">${list.length ? `${list.length} planned` : "Cinema night"}</span><h2 class="bang">Next outings</h2></div>
    ${list.map(row).join("") || `<p class="hint">Suggest a film in a Ghent cinema. Friends tap "I'm in", then you pick a date together.</p>`}
    <button class="${list.length ? "" : "primary"}" id="cnSuggest">🎟 Suggest an outing</button>
  </div>`;
}
function bindCinema(s) {
  const nom = async (sc, title, m) => {
    m ||= await matchMovie(title);
    const x = { m, sc };
    if (s.outs.has(ckey(x))) { M.toast("That outing is already planned."); return; }
    await act("nom", { tr: "m", r: monthOf(new Date()), m, sc }, { title: `${me.name} wants to see ${m.n}`, body: `${sc ? scLabel(sc) + ". " : ""}Tap "I'm in" if you want to come.` });
    M.toast(`${m.n} is up. Friends can tap "I'm in".`);
  };
  cineNominate = (sc, title) => nom(sc, title);
  $("cnSuggest")?.addEventListener("click", () => openScreenings((sc, title, m) => sc ? nom(sc, title, m) : openSearch("Suggest a film to go see", m => nom(null, m.n, m))));
  view.querySelectorAll("[data-in]").forEach(b => b.onclick = () => {
    const o = s.outs.get(b.dataset.in); if (!o) return; const v = o.ins.has(me.id) ? 0 : 1;
    if (v && o.sc?.d) scheduleOutingReminder(s, o, me.id);
    act("in", { ok: o.ok, v }, v ? { title: `${me.name} is in for ${o.m.n}`, body: o.sc?.d ? scLabel(o.sc) : "Pick a date in the club." } : null);
  });
  view.querySelectorAll("[data-odate]").forEach(b => b.onclick = () => {
    const o = s.outs.get(b.dataset.odate); if (!o) return;
    openDate({ ...o.m, sc: o.sc }, sc => (scheduleOutingReminder(s, { ...o, sc }), act("odate", { ok: o.ok, sc }, { title: `${o.m.n}: we're going ${scLabel(sc)}`, body: `${[...o.ins.values()].join(", ")} so far. Tap "I'm in" to join.` })));
  });
  view.querySelectorAll("[data-ospot]").forEach(b => b.onclick = () => {
    const o = s.outs.get(b.dataset.ospot); if (!o) return;
    const x = prompt("Drinks or dinner after? Where:", o.spot || ""); if (x == null) return;
    act("ospot", { ok: o.ok, x: x.trim() }, x.trim() ? { to: [...o.ins.keys()], title: `${o.m.n}: after, ${x.trim()}`, body: `${me.name} suggests ${x.trim()} after the film.` } : null);
  });
  view.querySelectorAll("[data-oics]").forEach(b => b.onclick = () => { const o = s.outs.get(b.dataset.oics); if (o) outingIcs(o); });
  view.querySelectorAll("[data-odrop]").forEach(b => b.onclick = () => { const o = s.outs.get(b.dataset.odrop); if (o && confirm(`Remove ${o.m.n}?`)) act("drop", { tr: "m", r: monthOf(new Date()), m: o.m, sc: o.sc }); });
}

// ---------- club watchlist ----------
let wlAll = false, wlQ = "", wlMsg = "", wlType = "all", wlView = "common";
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
function wlCard(s, cands, myVote, movie, cur, totalVotes) {
  const nominated = new Map(cands.map(x => [key(x.m), x]));
  const seenBy = t => [...(s.saw[seenKey(t)] || new Map()).values()].filter(x => x.v).length;
  const picked = new Set(Object.values(s.picks).map(key)); // already watched as a club: lives in History now
  const base = [...s.wl.values()].filter(w => !picked.has(key(w.m))).map(w => ({ ...w, nom: nominated.get(key(w.m)) }));
  // To watch list: what I added and haven't watched yet. Club watchlist: what the friends I pick added that I haven't watched.
  // Watching something takes it off both (it lives in My watched). Recommending is a separate, explicit step.
  const iSaw = w => !!s.saw[seenKey(w.m.n)]?.get(me.id)?.v;
  const friends = [...s.members.entries()].filter(([id]) => id !== me.id).map(([id, m]) => ({ id, name: m.name, n: base.filter(w => w.adders.has(id) && !iSaw(w)).length })).filter(p => p.n);
  for (const id of [...wlFriends]) if (!friends.some(f => f.id === id)) wlFriends.delete(id);
  const sel = wlFriends.size ? [...wlFriends] : friends.map(f => f.id);
  if (wlMode === "fy") wlMode = "mine";
  const mineAll = base.filter(w => w.adders.has(me.id) && !iSaw(w)), mineN = mineAll.length;
  let items = wlMode === "mine" ? mineAll : base.filter(w => !iSaw(w) && sel.some(id => w.adders.has(id)));
  const nTv = items.filter(w => w.m.t === "tv").length, mixed = nTv && nTv < items.length;
  const svc = myServices(), onMine = w => (provCache[key(w.m)]?.l || []).some(p => svc.has(p.id));
  const preStream = items;
  items = items.filter(w => (!wlQ || w.m.n.toLowerCase().includes(wlQ)) && (!mixed || wlType === "all" || w.m.t === wlType) && (wlMode === "club" || !wlStream || onMine(w)))
    .sort(wlSort === "az" ? (a, b) => a.m.n.localeCompare(b.m.n)
      : wlSort === "year" ? (a, b) => (+b.m.y || 0) - (+a.m.y || 0) || a.m.n.localeCompare(b.m.n)
      : (a, b) => b.adders.size - a.adders.size || b.at - a.at);
  const grouped = wlSort === "genre" && items.length >= 8 && !wlQ;
  const shown = grouped || wlAll || wlQ ? items : items.slice(0, 20);
  { const need = wlStream ? preStream : shown; setTimeout(() => fillProv(need), 0); } // streaming logos show on every tile automatically
  const sawBy = (t, id) => !!s.saw[seenKey(t)]?.get(id)?.v;
  const fchip = (id, l, n, on) => `<button class="chip${on ? " on" : ""}" data-wlf="${esc(id)}">${esc(l)}${n != null ? ` <i>${n}</i>` : ""}</button>`;
  // Netflix-style poster tiles: tap opens the title sheet (Watched?, remove, suggest, where to stream live there).
  const tile = w => {
    const l = provCache[key(w.m)]?.l || [], mp = l.filter(p => svc.has(p.id)), pv = (mp.length ? mp : l)[0];
    const mineSaw = !!s.saw[seenKey(w.m.n)]?.get(me.id)?.v, n = w.adders.size;
    return `<button class="wl-tile" data-open="${esc(key(w.m))}" aria-label="${esc(w.m.n)}">${poster(w.m.p, "w342")}
      ${pv ? `<img class="tile-prov${mp.length ? " mine" : ""}" src="${M.IMG}w92${esc(pv.logo)}" alt="${esc(pv.n)}" title="${esc(pv.n)}">` : ""}
      ${mineSaw ? `<i class="tile-ok" aria-label="You watched it">✓</i>` : ""}${w.m.t === "tv" ? `<i class="tile-tv">Series</i>` : ""}
      <span class="tile-t"><b>${esc(w.m.n)}</b>${w.m.y || n > 1 ? `<small>${esc(w.m.y || "")}${n > 1 ? ` · ${n} want it` : ""}</small>` : ""}</span></button>`;
  };
  // Long lists become Netflix-style rows per genre (each title in its main genre); short ones stay a simple grid.
  const tiles = list => {
    if (!grouped) return `<div class="wl-grid">${list.map(tile).join("")}</div>`;
    if (list.some(w => !genreCache[key(w.m)])) setTimeout(() => fillGenres(list), 0);
    const groups = {}; for (const w of list) (groups[genreOf(w.m) || "Loading…"] ||= []).push(w);
    return Object.entries(groups).sort((a, b) => (a[0] === "Loading…") - (b[0] === "Loading…") || (a[0] === "Other") - (b[0] === "Other") || b[1].length - a[1].length)
      .map(([g, ws]) => `<details class="g-sec" data-g="${esc(g)}"${genreOpen.has(g) ? " open" : ""}><summary>${esc(g)} <i>${ws.length}</i></summary><div class="wl-grid">${ws.map(tile).join("")}</div></details>`).join("");
  };
  return `<div class="fr-card" data-tab="weekly" id="wlCard">
    <div class="seg wl-mode" role="tablist"><button data-wlm="mine" aria-pressed="${wlMode === "mine"}">To watch <i>${mineN}</i></button><button data-wlm="club" aria-pressed="${wlMode === "club"}">Club list</button></div>
    <p class="hint" id="wlStatus"${wlMsg ? "" : " hidden"}>${esc(wlMsg)}</p>
    <input type="file" id="wlFile" accept=".csv,.zip,text/csv,application/zip" hidden>
    ${!hasDemo(active().id) && s.members.size < 3 ? `<button class="fy-demo" data-demo="1">Try it out: add test friends</button>` : ""}
    ${`
    ${wlMode === "club" && friends.length ? `<div class="wl-views">${fchip("*", "All friends", null, !wlFriends.size)}${friends.map(f => fchip(f.id, f.name, f.n, wlFriends.has(f.id))).join("")}</div>` : ""}
    ${wlMode === "club" && !friends.length ? `<p class="hint">Your friends' watchlists show up here once they add films. Invite them with the Invite button above.</p>` : ""}
    <div class="wl-tools">${wlMode === "mine" && mineN ? `<button class="chip${wlStream ? " on" : ""}" id="wlStream">📺 On my services${wlStream && provBusy ? "…" : ""}</button>` : ""}
      ${mixed ? `<span class="seg">${[["all", "All"], ["movie", "Films"], ["tv", "Series"]].map(([k, l]) => `<button class="${wlType === k ? "on" : ""}" data-wlt="${k}">${l}</button>`).join("")}</span>` : ""}
      ${items.length > 1 ? `<label class="wl-sort"><select id="wlSort" aria-label="Sort">${[["az", "A–Z"], ["genre", "By genre"], ["year", "By year"]].map(([k, l]) => `<option value="${k}"${wlSort === k ? " selected" : ""}>${l}</option>`).join("")}</select></label>` : ""}
      ${items.length > 12 || wlQ ? `<input type="search" id="wlQ" placeholder="Search" value="${esc(wlQ)}" autocomplete="off">` : ""}<button class="primary" id="cwAdd">+ Add</button></div>
    ${tiles(shown)}${items.length ? "" : `<p class="hint">${!base.length ? "Empty for now. Tap + Add to bring in your IMDb or Letterboxd watchlist." : wlMode === "mine" ? "Nothing left to watch on your list. Tap + Add to add more." : "Nothing here that you haven't watched yet."}</p>`}
    ${!grouped && !wlAll && !wlQ && items.length > shown.length ? `<button class="link" id="wlMore">Show all ${items.length}</button>` : ""}`}
  </div>`;
}
// ---------- genres for the watchlist rows (cached on this device) ----------
const genreCache = LS.get("marqueeGenres", {});
const genreOpen = new Set(); // genre sections you opened (folded by default so a long list stays a short overview)
let fyAuto = false, genreBusy = false, wlSort = LS.get("marqueeWlSort2", "az");
async function fillGenres(items) {
  if (genreBusy) return;
  const work = items.filter(w => !genreCache[key(w.m)]).slice(0, 400); if (!work.length) return;
  genreBusy = true;
  await Promise.all([1, 2, 3, 4].map(async () => { while (work.length) { const w = work.shift(); try { const j = await M.tm(`/${w.m.t}/${w.m.i}`); genreCache[key(w.m)] = (j.genres || []).map(g => g.name).slice(0, 3); if (!genreCache[key(w.m)].length) genreCache[key(w.m)] = ["Other"]; } catch {} } }));
  try { LS.set("marqueeGenres", genreCache); } catch {}
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
    return (infoCache[k] = { genres: (j.genres || []).map(g => g.name).slice(0, 3).join(", "), len, rate: j.vote_count > 20 && j.vote_average ? j.vote_average.toFixed(1) : "",
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
function renderSettingsExtras() {
  const st = $("setStream"), pu = $("setPush");
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
function forYouCard(s) {
  const mine = sugForMe(s), sent = sugSent(s), today = iso(new Date());
  const due = mine.filter(g => accAt(s, g, me.id)), fresh = mine.filter(g => !accAt(s, g, me.id));
  const row = (g, out) => {
    const rec = sugTo(s, g), done = out ? rec.length && rec.every(id => !sugOpen(s, g, id)) : !sugOpen(s, g, me.id);
    const rv = id => s.saw[seenKey(g.m.n)]?.get(id);
    const who = rec.map(id => `<span class="who${sugOpen(s, g, id) ? accAt(s, g, id) ? " acc" : "" : " ok"}"${rv(id)?.x ? ` title="${esc(rv(id).x)}"` : accAt(s, g, id) && sugOpen(s, g, id) ? ` title="Accepted, watching by ${esc(byLabel(accBy(s, g, id)))}"` : ""}>${sugOpen(s, g, id) ? accAt(s, g, id) ? "👍 " : "" : "✓ "}${esc(s.members.get(id)?.name || "someone")}${rv(id)?.v && rv(id).s ? ` ${rv(id).s}★` : ""}</span>`).join("");
    const by = accBy(s, g, me.id), late = by && by < today;
    return `<div class="wl-i sug-i${!out && !done && by && by <= isoAdd(today, 2) ? " due" : ""}${done ? " done" : ""}"><button class="wl-open" data-open="${esc(key(g.m))}">${poster(g.m.p, "w92")}${done ? `<i class="ok-badge" aria-label="${out ? "Everyone watched it" : "You watched it"}">✓</i>` : ""}</button><div class="body" data-open="${esc(key(g.m))}">
      <b>${esc(g.m.n)}${g.m.y ? ` <small>${esc(g.m.y)}</small>` : ""}${g.m.t === "tv" ? ` <span class="tv-tag">Series</span>` : ""}</b>
      ${out ? `<span class="whos">${who}</span>` : ""}<small class="hint">${[out ? (done ? "Everyone watched it" : g.to.includes("*") ? "To everyone" : "") : `From ${esc(g.by)}`,
        done ? (out ? "" : "You watched it") : out ? "" : by ? (late ? `⏰ was due ${esc(byLabel(by))}` : `👍 Watch by ${esc(byLabel(by))}`) : "New",
        (s.talk[seenKey(g.m.n)] || []).length ? `💬 ${(s.talk[seenKey(g.m.n)] || []).length}` : "", out ? `<button class="link" data-sugdrop="${esc(g.id)}">remove</button>` : ""].filter(Boolean).join(" · ")}</small>
    </div>${out ? "" : !done && !by ? `<button class="acc-btn" data-acc="${esc(g.id)}">Accept</button>` : seenTag(g.m.n, true)}</div>`;
  };
  if (!mine.length && !sent.length && !sugForMeSeen(s).length && !newReviews(s).length) return "";
  return `<div class="fr-card" data-tab="mine" id="fyCard"><h3>For you${fresh.length ? ` <i class="fy-n">${fresh.length} new</i>` : ""}</h3>
    ${(() => { const nr = newReviews(s); return nr.length ? `<div class="rev-new"><b>🎬 Your suggestions got watched</b>${nr.slice(0, 5).map(r => `<p><b>${esc(r.name)}</b> watched <b>${esc(r.m.n)}</b>${r.s ? ` <span class="stars">${starStr(r.s)}</span>` : ""}${r.x ? `<br><i>“${esc(r.x)}”</i>` : ""}</p>`).join("")}<button class="link" id="revRead">Got it</button></div>` : ""; })()}
    <h4 class="wl-sec">Suggestions <i>${fresh.length || ""}</i></h4>
    <div class="wl-list">${fresh.map(g => row(g, false)).join("") || `<p class="hint">Nothing new. When a friend suggests something, it shows up here.</p>`}</div>
    ${due.length ? `<h4 class="wl-sec">Accepted <i>${due.length}</i></h4><div class="wl-list">${due.map(g => row(g, false)).join("")}</div>` : ""}
    ${(() => { const seenL = sugForMeSeen(s); return seenL.length ? `<h4 class="wl-sec">Watched <i>${seenL.length}</i></h4><div class="wl-list">${seenL.map(g => row(g, false)).join("")}</div>` : ""; })()}
    ${sent.length ? `<h4 class="wl-sec">You suggested <i>${sent.length}</i></h4><div class="wl-list">${sent.map(g => row(g, true)).join("")}</div>` : ""}
  </div>`;
}
function findTitle(s, k) {
  return s.wl.get(k)?.m || s.sugs.find(g => key(g.m) === k)?.m || [...s.outs.values()].find(o => key(o.m) === k)?.m || Object.values(s.saw).length && Object.keys(s.saw).map(sk => titleBySk(s, sk)).find(m => m && key(m) === k) || Object.values(s.picks).find(m => key(m) === k) || null;
}
function openTitleByKey(s, k, focusSuggest) { const m = findTitle(s, k); if (m) openTitle(s, m, focusSuggest); }
// Download a calendar file with a weekly repeat, so the phone's own calendar reminds you.
function icsFor(g) {
  const d = g.d.replace(/-/g, ""), stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Marquee//Movie club//EN", "BEGIN:VEVENT", `UID:${g.id}@marquee`, `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${d}`, `SUMMARY:Watch ${g.m.n.replace(/[,;]/g, " ")}`, `DESCRIPTION:Suggested by ${g.by} in Marquee. ${APP_URL}`, ...(g.wk ? ["RRULE:FREQ=WEEKLY;COUNT=12"] : []),
    "BEGIN:VALARM", "TRIGGER:PT19H", "ACTION:DISPLAY", `DESCRIPTION:Watch ${g.m.n.replace(/[,;]/g, " ")}`, "END:VALARM", "END:VEVENT", "END:VCALENDAR"];
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([lines.join("\r\n")], { type: "text/calendar" })); a.download = `watch-${seenKey(g.m.n).replace(/[^a-z0-9]+/g, "-")}.ics`;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
let titleSheet = null;
function openTitle(s, m, focusSuggest) {
  titleSheet?.remove();
  const sk = seenKey(m.n), others = [...s.members.entries()].filter(([id]) => id !== me.id);
  const sugs = s.sugs.filter(g => key(g.m) === key(m));
  const forMe = sugs.filter(g => g.a !== me.id && sugTo(s, g).includes(me.id));
  const seen = [...(s.saw[sk] || new Map()).entries()].filter(([, x]) => x.v).map(([id, x]) => id === me.id ? "you" : x.name);
  const talk = (s.talk[sk] || []).slice(-30);
  const wl = s.wl.get(key(m));
  const next = iso(nightAfter(now(), s.day));
  const bg = el(`<div class="sheet-bg"><div class="sheet title-sheet" role="dialog" aria-label="${esc(m.n)}">
    <div class="ts-head">${poster(m.p, "w154")}<div><h3>${esc(m.n)}${m.y ? ` <small class="hint">${esc(m.y)}</small>` : ""}</h3>
      <small class="hint">${m.t === "tv" ? "Series · " : ""}${wl ? `On the list of ${esc([...wl.adders.entries()].map(([a, n]) => a === me.id ? "you" : n).join(", "))}` : ""}${wl?.adders.has(me.id) ? ` · <button class="link" data-tsdrop>remove from my list</button>` : ` · <button class="link" data-tsadd>add to my list</button>`}</small>
      <small class="hint">${seen.length ? `Watched by ${esc(seen.join(", "))}` : "Nobody has watched it yet"}</small>
      <span class="ts-acts">${seenTag(m.n)}${imdbLink(m)}</span></div></div>
    <div class="ts-info"><small class="hint">Loading info…</small></div>
    <div class="ts-prov"><small class="hint">Where to stream…</small></div>
    ${forMe.map(g => `<div class="sug-due">Suggested by ${esc(g.by)}${!sugOpen(s, g, me.id) ? " · you watched it" : accAt(s, g, me.id) ? ` · 👍 you'll watch it by ${esc(byLabel(accBy(s, g, me.id)))}` : ` <button class="primary acc-btn" data-acc="${esc(g.id)}">Accept</button>`}</div>`).join("")}
    ${others.length ? `<button class="ts-sug-open" id="tsSugOpen">📣 Suggest to friends</button><div class="ts-sug" hidden><div class="wl-views ts-to"><button class="chip" data-to="*">Everyone</button>${others.map(([id, x]) => `<button class="chip" data-to="${esc(id)}">${esc(x.name)}</button>`).join("")}</div>
      <button class="primary" id="tsGo" disabled>Pick who to suggest it to</button></div>` : ""}
    ${sugs.length ? `<small class="hint">${sugs.map(g => `${g.a === me.id ? "You" : esc(g.by)} → ${esc(whoLabel(s, g))}${g.a === me.id ? ` <button class="link" data-sugdrop="${esc(g.id)}">remove</button>` : ""}`).join(" · ")}</small>` : ""}
    ${(() => { const rs = [...(s.saw[sk] || new Map()).entries()].filter(([, x]) => x.v && (x.s || x.x)); const n = rs.length + talk.length;
      return `<h4 class="wl-sec">Reviews &amp; talk <i>${n || ""}</i></h4><div class="ts-talk">${rs.map(([id, x]) => `<p class="ts-rev"><b>${esc(id === me.id ? "You" : x.name)}</b>${x.s ? ` <span class="stars">${starStr(x.s)}</span>` : ""}${x.x ? ` ${esc(x.x)}` : ""}</p>`).join("")}${talk.map(e => `<p><b>${esc(e.a === me.id ? "You" : e.n)}</b> ${esc(e.x)}</p>`).join("") || (rs.length ? "" : `<small class="hint">No reviews or thoughts yet.</small>`)}</div>`; })()}
    <div class="say"><input type="text" id="tsSay" maxlength="600" placeholder="Share what you thought…" enterkeyhint="send"><button class="primary" id="tsSend">Send</button></div>
    <button id="tsClose">Close</button></div></div>`);
  document.body.appendChild(bg); titleSheet = bg;
  titleInfo(m).then(i => {
    const box = bg.querySelector(".ts-info"); if (!box) return;
    if (!i) { box.innerHTML = ""; return; }
    const facts = [i.genres, i.len, i.rate ? `★ ${i.rate}/10 on TMDB` : ""].filter(Boolean).join(" · ");
    box.innerHTML = `${facts ? `<small class="ts-facts">${esc(facts)}</small>` : ""}
      ${i.by ? `<small class="hint">${m.t === "tv" ? "Created by" : "Directed by"} <b>${esc(i.by)}</b></small>` : ""}
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
  bg.addEventListener("click", e => { if (e.target === bg || e.target.id === "tsClose") close(); });
  bg.querySelector("[data-tsdrop]")?.addEventListener("click", () => { act("wldrop", { m }); M.toast(`${m.n} removed from your list.`); bg.remove(); });
  bg.querySelector("[data-tsadd]")?.addEventListener("click", () => { act("wl", { m }); M.toast(`${m.n} added to your list.`); bg.remove(); });
  const sugOpenBtn = bg.querySelector("#tsSugOpen"), sugBox = bg.querySelector(".ts-sug");
  sugOpenBtn?.addEventListener("click", () => { sugBox.hidden = false; sugOpenBtn.hidden = true; sugBox.scrollIntoView({ block: "nearest" }); });
  if (focusSuggest && sugOpenBtn) { sugOpenBtn.click(); setTimeout(() => bg.querySelector(".ts-to")?.scrollIntoView({ block: "center" }), 50); }
}

// ---------- test friends (only on this device) ----------
const DEMO = [
  { id: "demo_lotte", n: "Lotte", wl: ["Past Lives", "Aftersun", "Severance"], saw: ["Aftersun"] },
  { id: "demo_jonas", n: "Jonas", wl: ["Dune: Part Two", "The Bear", "Oppenheimer"], saw: ["Oppenheimer"] },
  { id: "demo_emma", n: "Emma", wl: ["Poor Things", "Fallen Leaves", "Shōgun"], saw: ["Fallen Leaves"] },
];
const hasDemo = clubId => Object.values(evs(clubId)).some(e => e.demo);
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
  const map = evs(c.id); for (const [i, e] of Object.entries(map)) if (e.demo) delete map[i];
  save(c.id); render(); M.toast("Test friends removed.");
}

function bindWl(s, cands) {
  const status = t => { wlMsg = t || ""; const n = $("wlStatus"); if (n) { n.hidden = !t; n.textContent = wlMsg; } };
  const addAll = (ms, label, seenIt) => {
    const have = new Set([...s.wl.values()].filter(w => w.adders.has(me.id)).map(w => key(w.m)));
    const fresh = []; const seen = new Set();
    for (const m of ms) { const k = key(m); if ((have.has(k) && !seenIt) || seen.has(k)) continue; seen.add(k); fresh.push(m); }
    if (!fresh.length) { M.toast("Those are all on the club watchlist already."); return; }
    if (seenIt) {
      // Imported ratings/diary only mark titles as watched (with stars and dates); they don't go on anyone's to-watch list.
      actMany(fresh.map(({ _s, _d, ...m }) => ["saw", { sk: seenKey(m.n), v: 1, imp: 1, m, ...(_d ? { d: _d } : {}), ...(_s ? { s: _s } : {}) }]), null);
      M.toast(`${fresh.length === 1 ? fresh[0].n : fresh.length + " titles"} marked as watched.`); return;
    }
    actMany(fresh.map(({ _s, _d, ...m }) => ["wl", { m }]), { title: `${me.name} added ${fresh.length} film${fresh.length === 1 ? "" : "s"} to the club watchlist`, body: label });
    M.toast(`${fresh.length} film${fresh.length === 1 ? "" : "s"} added to your To watch list.`);
  };
  const fromSearch = () => openSearch("Add to your To watch list", m => addAll([m], m.n));
  { const so = view.querySelector("#wlSort"); if (so) so.onchange = () => { wlSort = so.value; LS.set("marqueeWlSort2", wlSort); wlAll = true; render(); }; }
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
      <small class="hint">Watchlists go on your To watch list. Ratings and diaries mark titles as watched.</small>
      ${saved ? `<button class="link" data-a="saved">Or add the ${saved} titles from your Marquee watchlist</button>` : ""}
      <button data-a="x">Cancel</button></div></div>`);
    document.body.appendChild(bg);
    bg.addEventListener("click", e => { const a = e.target.closest("[data-a]")?.dataset.a; if ((e.target !== bg && !a) || a === "go") return; bg.remove(); if (a === "file") fromFile(); else if (a === "saved") fromSaved(); });
  };
  $("cwAdd")?.addEventListener("click", () => openSearch("Add to your To watch list", m => addAll([m], m.n), "", { html: `<button class="link imp-link" data-foot="import">Import a whole list from IMDb or Letterboxd</button>`, on: openImport }));
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
      const f = await M.tm("/find/" + tt, { external_source: "imdb_id" }), x = (f.movie_results || [])[0] || (f.tv_results || [])[0];
      return x ? { t: x.title ? "movie" : "tv", i: x.id, n: x.title || x.name, y: (x.release_date || x.first_air_date || "").slice(0, 4), p: x.poster_path || "", im: tt, _s: seen.get(tt) || 0, _d: dates.get(tt) || "" } : null;
    }, "IMDb titles");
    return { out, missed, total: seen.size, seenIt: ri >= 0, src: ri >= 0 ? "IMDb ratings" : "IMDb watchlist" };
  };
  const fromLbRows = async (rows, kind) => {
    const head = rows[0].map(h => h.trim().toLowerCase()), ni = head.indexOf("name"), yi = head.indexOf("year"), ri = head.indexOf("rating"), di = head.indexOf("watched date") >= 0 ? head.indexOf("watched date") : head.indexOf("date");
    const seenIt = kind === "seen" || ri >= 0, films = new Map();
    for (const r of rows.slice(1)) { const n = (r[ni] || "").trim(); if (!n) continue; const k = n + "|" + (r[yi] || ""); const sc = ri >= 0 ? Math.round((+r[ri] || 0) * 2) / 2 : 0; const d = di >= 0 && /^\d{4}-\d\d-\d\d/.test(r[di] || "") ? r[di].slice(0, 10) : ""; if (!films.has(k) || sc) films.set(k, { n, y: (r[yi] || "").trim(), s: sc, d }); }
    const { out, missed } = await pool([...films.values()], async f => {
      let j = await M.tm("/search/movie", { query: f.n, ...(f.y ? { year: f.y } : {}) });
      if (!(j.results || []).length && f.y) j = await M.tm("/search/movie", { query: f.n });
      const x = (j.results || [])[0];
      return x ? { t: "movie", i: x.id, n: x.title, y: (x.release_date || "").slice(0, 4), p: x.poster_path || "", _s: Math.max(0, Math.min(5, f.s)), _d: f.d } : null;
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
        const wl = await read("watchlist.csv"), rated = await read("ratings.csv"), watched = await read("watched.csv");
        if (!wl && !rated && !watched) { status("That ZIP doesn't look like a Letterboxd export."); return; }
        const msg = [];
        if (wl && wl.length > 1) { const r = await fromLbRows(wl, "want"); addAll(r.out, "From their Letterboxd watchlist"); msg.push(`${r.out.length} of ${r.total} watchlist films found.`); }
        // ratings carry stars; watched adds the films seen without a rating
        const seenRows = rated && rated.length > 1 ? rated : null, extra = watched && watched.length > 1 ? watched : null;
        if (seenRows || extra) {
          const r1 = seenRows ? await fromLbRows(seenRows, "seen") : { out: [], missed: 0, total: 0 };
          const r2 = extra ? await fromLbRows(extra, "seen") : { out: [], missed: 0, total: 0 };
          const have = new Set(r1.out.map(key)), all = [...r1.out, ...r2.out.filter(m => !have.has(key(m)))];
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
      report(r); addAll(r.out, `From their ${r.src}`, r.seenIt);
    } catch (x) { console.error(x); status("Couldn't read that file. Try exporting it again."); }
  });
  $("wlQ")?.addEventListener("input", e => { wlQ = e.target.value.toLowerCase(); keepInputs(renderClub); });
  view.querySelectorAll("[data-wlm]").forEach(x => x.onclick = () => { wlMode = x.dataset.wlm; LS.set("marqueeWlMode", wlMode); wlAll = false; render(); });
  view.querySelectorAll("[data-wlf]").forEach(x => x.onclick = () => { const id = x.dataset.wlf; if (id === "*") wlFriends.clear(); else wlFriends.has(id) ? wlFriends.delete(id) : wlFriends.add(id); LS.set("marqueeWlFriends", [...wlFriends]); wlAll = false; render(); });
  $("wlMore")?.addEventListener("click", () => { wlAll = true; render(); });
  view.querySelectorAll("details.g-sec").forEach(d => d.addEventListener("toggle", () => { d.open ? genreOpen.add(d.dataset.g) : genreOpen.delete(d.dataset.g); }));
  $("wlStream")?.addEventListener("click", () => { if (!myServices().size) { M.toast("Pick your streaming services in Settings first."); M.setView("settings"); return; } wlStream = !wlStream; render(); });
  view.querySelectorAll("[data-wldrop]").forEach(b => b.onclick = () => { const w = s.wl.get(b.dataset.wldrop); if (w) act("wldrop", { m: w.m }); });
  view.querySelectorAll("[data-sug]").forEach(b => b.onclick = () => openTitleByKey(s, b.dataset.sug, true));
  view.querySelectorAll("#clubView [data-open]").forEach(b => b.onclick = e => { if (e.target.closest("a, [data-wldrop], [data-saw]")) return; openTitleByKey(s, b.dataset.open); });
}

// ---------- face-off ----------
const vsSeen = new Set();
function faceoff(a, b, myVote) {
  const side = (x, cls) => `<div class="fo-side ${cls}">${poster(x.m.p, "w185")}<b>${esc(x.m.n)}</b><small>${x.votes} vote${x.votes === 1 ? "" : "s"}</small>${seenTag(x.m.n)}
    <button class="vote${myVote === key(x.m) ? " on" : ""}" data-vote="${esc(key(x.m))}">${myVote === key(x.m) ? "✓ Voted" : "Vote"}</button></div>`;
  return `<div class="faceoff">${side(a, "l")}<div class="fo-vs"><span>VS</span></div>${side(b, "r")}</div>`;
}

// ---------- history ----------
let wrapData = null;
// The wrap-up as a 1080×1350 image (posters + stats), shared with the phone's share sheet or downloaded.
async function shareWrap() {
  const w = wrapData; if (!w) return;
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
  line("Watched together", `${w.titles} titles · ${w.outs} cinema outing${w.outs === 1 ? "" : "s"}`, y); y += 100;
  line("Most watched", w.most.n, y); y += 100;
  if (w.best) { line("Best rated", `${w.best.n} · ${w.bestAvg.toFixed(1)} ★`, y); y += 100; }
  if (w.top) line("Top reviewer", `${w.top} · ${w.topN} review${w.topN === 1 ? "" : "s"}`, y);
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
  const past = [...s.outs.values()].filter(o => o.sc?.d && o.sc.d < today && o.ins.size).sort((a, b) => b.sc.d.localeCompare(a.sc.d)).slice(0, 12);
  return past.length ? `<div class="fr-card" data-tab="monthly"><h3>Past outings</h3>${past.map(o => `<div class="out-i" data-open="${esc(key(o.m))}">${poster(o.m.p, "w92")}<div class="body"><b>${esc(o.m.n)}</b><span class="ticket-line">🎟 ${esc(scLabel(o.sc))}</span><span class="whos">${[...o.ins.values()].map(n => `<span class="who ok">${esc(n)}</span>`).join("")}</span></div></div>`).join("")}</div>` : "";
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
    if (!x.v) continue; const when = x.d || iso(new Date(x.at || 0)); if (!inYr(when)) continue;
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
  const cats = [
    { e: "🏆", t: "Most watched", d: "Films and series seasons logged as just watched", v: id => W[id].length, u: "watched" },
    { e: "🎬", t: "Film buff", d: "Most films", v: id => W[id].filter(w => w.m.t !== "tv").length, u: "films" },
    { e: "📺", t: "Binge king", d: "Most series seasons", v: id => W[id].filter(w => w.m.t === "tv").reduce((n, w) => n + (w.ss?.length || 1), 0), u: "seasons" },
    { e: "🔥", t: "Longest streak", d: "Weeks in a row with something watched", v: streak, u: "weeks" },
    { e: "⚡", t: "Busiest week", d: "Most watched in any 7 days", v: bestWeek, u: "in a week" },
    { e: "📅", t: "Best month", d: "Most watched in one month", v: id => bestMonth(id)?.v || 0, note: id => bestMonth(id)?.note, u: "" },
    { e: "✍️", t: "Critic of the year", d: "Most reviews written", v: id => reviews[id] || 0, u: "reviews" },
    { e: "⭐", t: "Star giver", d: "Most ratings given", v: id => (rated[id] || []).length, u: "ratings" },
    { e: "😇", t: "Softie", d: "Highest average rating (3+ ratings)", v: id => (rated[id] || []).length >= 3 ? +avg(rated[id]).toFixed(2) : 0, fmt: v => v.toFixed(1) + " ★" },
    { e: "😈", t: "Harshest critic", d: "Lowest average rating (3+ ratings)", v: id => (rated[id] || []).length >= 3 ? +avg(rated[id]).toFixed(2) : 0, low: true, fmt: v => v.toFixed(1) + " ★" },
    { e: "🎯", t: "Best taste", d: "Their suggestions that friends then watched", v: id => landed[id] || 0, u: "landed" },
    { e: "📣", t: "Top recommender", d: "Suggestions sent", v: id => sugY.filter(g => g.a === id).length, u: "sent" },
    { e: "👍", t: "Yes person", d: "Suggestions accepted", v: id => accepted[id] || 0, u: "accepted" },
    { e: "🏃", t: "Quickest to watch", d: "Fastest average from suggestion to watched (2+)", v: id => (speed[id] || []).length >= 2 ? +avg(speed[id]).toFixed(1) : 0, low: true, fmt: v => v < 1 ? "same day" : `${v.toFixed(1)} days` },
    { e: "🍿", t: "Cinema regular", d: "Cinema outings joined", v: id => went[id] || 0, u: "outings" },
    { e: "🗓️", t: "Organiser", d: "Cinema outings suggested", v: id => organised[id] || 0, u: "suggested" },
    { e: "💬", t: "Chatterbox", d: "Comments on titles", v: id => talk[id] || 0, u: "comments" },
    { e: "📚", t: "Watchlist hoarder", d: "Titles on their watchlist right now", v: id => wlNow[id] || 0, u: "titles" },
    { e: "🌍", t: "Explorer", d: "Different titles watched", v: uniq, u: "titles" },
  ];
  const cards = cats.map((c, ci) => {
    const rows = ids.map(id => ({ id, v: c.v(id) })).filter(r => r.v > 0).sort((a, b) => c.low ? a.v - b.v : b.v - a.v);
    if (!rows.length) return `<div class="ld-card empty"><div class="ld-h"><span class="ld-e">${c.e}</span><div><b>${esc(c.t)}</b><small class="hint">${esc(c.d)}</small></div></div><p class="hint">Nobody yet.</p></div>`;
    const val = r => c.fmt ? c.fmt(r.v) : `${r.v}${c.u ? " " + (r.v === 1 && c.u.endsWith("s") ? c.u.slice(0, -1) : c.u) : ""}${c.note?.(r.id) ? ` · ${c.note(r.id)}` : ""}`;
    let rank = 0, prev = null;
    const ranked = rows.map((r, i) => { if (r.v !== prev) { rank = i + 1; prev = r.v; } return { ...r, rank }; });
    const open = ldOpen.has(ci), shown = open ? ranked : ranked.filter(r => r.rank <= 3);
    return `<div class="ld-card"><div class="ld-h"><span class="ld-e">${c.e}</span><div><b>${esc(c.t)}</b><small class="hint">${esc(c.d)}</small></div></div>
      <ol class="ld-list">${shown.map(r => `<li class="r${r.rank}${r.id === me.id ? " me" : ""}"><span class="ld-r">${["🥇", "🥈", "🥉"][r.rank - 1] || r.rank}</span><span class="ld-n">${esc(nm(r.id))}</span><span class="ld-v">${esc(val(r))}</span></li>`).join("")}</ol>
      ${ranked.length > ranked.filter(r => r.rank <= 3).length ? `<button class="link" data-ldmore="${ci}">${open ? "Show less" : `All ${ranked.length}`}</button>` : ""}</div>`;
  });
  const yrs = [...years].filter(y => y > 1990).sort((a, b) => b - a);
  return `<div class="fr-card pulp"><div class="pulp-head"><span class="chapter">${esc(s.name || "Movie club")}</span><h2 class="bang">Leaderboard</h2></div>
    ${yrs.length > 1 ? `<div class="wl-views">${yrs.map(y => `<button class="chip${y === ldYear ? " on" : ""}" data-ldy="${y}">${y}</button>`).join("")}</div>` : ""}
    <p class="hint">Who leads ${ldYear} in every category. Prizes at the end of the year.</p></div>
    ${ldYear === new Date().getFullYear() ? lastWrapHtml : ""}
    <div class="ld-grid">${[...cards.filter(c => !c.includes("ld-card empty")), ...cards.filter(c => c.includes("ld-card empty"))].join("")}</div>`;
}
function bindLeaders() {
  $("wrapShare")?.addEventListener("click", shareWrap);
  lead.querySelectorAll("[data-ldy]").forEach(b => b.onclick = () => { ldYear = +b.dataset.ldy; lead.innerHTML = leadersHtml(lastState); bindLeaders(); });
  lead.querySelectorAll("[data-ldmore]").forEach(b => b.onclick = () => { const i = +b.dataset.ldmore; ldOpen.has(i) ? ldOpen.delete(i) : ldOpen.add(i); lead.innerHTML = leadersHtml(lastState); bindLeaders(); });
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
      <b class="t">${esc(it.m.n)}${it.m.y ? ` <small class="hint">(${esc(it.m.y)})</small>` : ""}${it.m.t === "tv" ? ` <span class="tv-tag">Series</span>` : ""}</b>
      ${it.avg ? `<span class="stars">${starStr(it.avg)}</span><small class="hint">${it.avg.toFixed(1)} from ${it.who.filter(([, x]) => x.s).length}</small>` : ""}
      <div class="hrev">${it.who.map(([id, x]) => `<p><b>${esc(id === me.id ? "You" : x.name)}</b>${x.s ? ` <span class="stars">${starStr(x.s, true)}</span>` : ""}${x.x ? ` ${esc(x.x)}` : ""}</p>`).join("")}</div>
    </div></div></div>`;
  const yr = new Date().getFullYear(), y0 = new Date(yr, 0, 1).getTime();
  const yItems = items.map(it => ({ ...it, who: it.who.filter(([, x]) => (x.at || 0) >= y0) })).filter(it => it.who.length);
  const wrap = yItems.length ? (() => {
    const most = [...yItems].sort((a, b) => b.who.length - a.who.length || b.last - a.last)[0];
    const rated = yItems.map(it => { const sc = it.who.map(([, x]) => x.s).filter(Boolean); return { it, avg: sc.length ? sc.reduce((a, b) => a + b, 0) / sc.length : 0 }; }).filter(x => x.avg).sort((a, b) => b.avg - a.avg)[0];
    const rev = {}; for (const it of yItems) for (const [id, x] of it.who) if (x.s || x.x) rev[id] = { n: x.name, c: (rev[id]?.c || 0) + 1 };
    const top = Object.entries(rev).sort((a, b) => b[1].c - a[1].c)[0];
    const outs = past.filter(o => o.sc.d >= `${yr}-01-01`).length;
    wrapData = { yr, name: s.name || "Movie club", titles: yItems.length, most: most.m, mostN: most.who.length, best: rated?.it.m, bestAvg: rated?.avg, top: top ? (top[0] === me.id ? me.name : top[1].n) : "", topN: top?.[1].c || 0, outs, posters: [...new Set(yItems.map(it => it.m.p).filter(Boolean))].slice(0, 10) };
    return `<div class="fr-card wrapup"><h3>${yr} wrap-up</h3><div class="wrap-grid">
      <div><small>Watched</small><b>${yItems.length}</b></div><div><small>Outings</small><b>${outs}</b></div>
      <div><small>Most watched</small><b>${esc(most.m.n)}</b><i>${most.who.length} of you</i></div>
      ${rated ? `<div><small>Best rated</small><b>${esc(rated.it.m.n)}</b><i>${rated.avg.toFixed(1)} ★</i></div>` : ""}
      ${top ? `<div><small>Top reviewer</small><b>${esc(top[0] === me.id ? "You" : top[1].n)}</b><i>${top[1].c} review${top[1].c === 1 ? "" : "s"}</i></div>` : ""}
    </div><button class="primary" id="wrapShare">Share as an Instagram post</button></div>`;
  })() : "";
  lastWrapHtml = wrap;
  return head
    + (items.length ? items.map(card).join("") : `<div class="fr-card"><p class="hint">Nothing watched yet. When someone taps Watched? on a title, it lands here with their stars and review.</p></div>`)
    + (past.length ? `<div class="fr-card"><h3>Past outings</h3>${past.map(o => `<div class="out-i">${poster(o.m.p, "w92")}<div class="body"><b>${esc(o.m.n)}</b><span class="ticket-line">🎟 ${esc(scLabel(o.sc))}</span><span class="whos">${[...o.ins.values()].map(n => `<span class="who ok">${esc(n)}</span>`).join("")}</span></div></div>`).join("")}</div>` : "");
}

const CH_WORDS = ["one","two","three","four","five","six","seven","eight","nine","ten","eleven","twelve","thirteen","fourteen","fifteen","sixteen","seventeen","eighteen","nineteen","twenty"];
const chapterWord = n => CH_WORDS[n - 1] || String(n);
// The club page is split into tabs so nothing needs a long scroll on a phone.
let clubTab = (() => { let t = "weekly"; try { t = sessionStorage.getItem("marqueeClubTab") || "weekly"; } catch {} return { week: "weekly", vote: "weekly", cine: "monthly", cal: "monthly" }[t] || t; })();
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
  const others = clubs().filter(x => x.id !== c.id);
  const vs = cands.length >= 2, vsKey = vs ? `${c.id}:${cur}:${key(cands[0].m)}:${key(cands[1].m)}` : "";
  const vsStill = !vs || vsSeen.has(vsKey) || !!myVote;
  if (vs) vsSeen.add(vsKey);
  const calH = calEvents(s, "home"), calC = calEvents(s, "cine");
  const cineDot = outings(s).some(o => !o.ins.has(me.id) && o.at > (s.members.get(me.id)?.last || 0) - 864e5 * 7);
  view.dataset.tab = clubTab;

  view.innerHTML = `
    <div class="fr-card">
      <div class="fr-row"><div style="flex:1;min-width:0"><h2 style="margin:0">${esc(s.name || c.name)}</h2><small class="hint">${members.length} member${members.length === 1 ? "" : "s"}</small></div>
        <button id="cbInvite">Invite</button><button id="cbGear" class="gear${clubTab === "set" ? " on" : ""}" aria-label="Club settings">⚙</button></div>
      <div class="faces">${members.map(([id, m]) => avatar(m.name, movie && rd.seen.has(id))).join("")}</div>
      <p class="hint" id="clubOffline"${online ? " hidden" : ""}>Can't reach the club right now. What you do is saved here and sent when you're back online.</p>
    </div>
    <div class="club-tabs" role="tablist">${[["mine", "My watched", sugForMe(s).some(g => sugNew(s, g) || sugDueToday(g))], ["weekly", "The Club", false], ["monthly", "At the cinema", cineDot]]
      .map(([k, l, dot]) => `<button role="tab" data-ct="${k}" aria-selected="${clubTab === k}"${dot ? ' class="dot"' : ""}>${l}</button>`).join("")}</div>
    <div class="ccol c0"><h2 class="sec-h">My watched <small>what you've seen, and what's for you</small></h2>
    ${myWatchedCard(s)}
    ${forYouCard(s)}
    </div><div class="ccol c1"><h2 class="sec-h">The Club <small>suggest, watch, talk</small></h2>

    ${wlCard(s, cands, myVote, movie, cur, totalVotes)}
    </div><div class="ccol c2"><h2 class="sec-h">At the cinema <small>go see it together</small></h2>
    ${cinemaCard(s, members)}
    <div class="fr-card" data-tab="monthly"><h3>Cinema calendar</h3><div id="cbCal">${calHtml(s, calC, "cine")}</div></div>
    ${pastOutingsHtml(s)}



    <div class="fr-card" data-tab="set">
      <details class="more" open><summary>Club settings</summary>
        <div style="display:flex;flex-direction:column;gap:10px;margin-top:10px">
          <label>Your name <input type="text" id="cbMe" maxlength="40" value="${esc(me.name)}"></label>
          <label>Club name <input type="text" id="cbRename" maxlength="40" value="${esc(s.name || c.name)}"></label>
          <button id="cbSaveSet">Save</button>
          ${others.length ? `<p class="hint">Your other clubs:</p>${others.map(o => `<button data-switch="${esc(o.id)}">Switch to ${esc(o.name)}</button>`).join("")}` : ""}
          <button id="cbNew">Start or join another club</button>
          ${hasDemo(c.id) ? `<button id="cbDemoOff">Remove test friends</button>` : `<button id="cbDemo">Add test friends (only you see them)</button>`}
          <button class="link" id="cbLeave">Leave this club on this device</button>
        </div>
      </details>
    </div>
    </div>`;

  hist.innerHTML = historyHtml(s);
  if (lead) { lead.innerHTML = leadersHtml(s); bindLeaders(); }
  bind(c, s, cands, movie);
  bindCinema(s);
  bindCal(s, calH, "home"); bindCal(s, calC, "cine");
  bindWl(s, cands);
  $("mwLog")?.addEventListener("click", () => openSearch("What did you watch?", m => openReview(derive(active().id), seenKey(m.n), m)));
  $("mwMore")?.addEventListener("click", () => { mwAll = true; renderClub(); });
  document.querySelectorAll("[data-mww]").forEach(b => b.onclick = () => { mwWho = b.dataset.mww; mwAll = false; renderClub(); });
  document.querySelectorAll("[data-mwy]").forEach(b => b.onclick = () => { mwYear = +b.dataset.mwy; mwAll = false; renderClub(); });
}

function bind(c, s, cands, movie) {
  const cur = s.cur;
  view.querySelectorAll("[data-ct]").forEach(b => b.onclick = () => setClubTab(b.dataset.ct));
  $("cbGear").onclick = () => setClubTab(clubTab === "set" ? "weekly" : "set");
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
  $("cbSaveSet").onclick = () => {
    const n = $("cbMe").value.trim(), cn = $("cbRename").value.trim(), day = s.day;
    if (n && n !== me.name) ensureMe(n.slice(0, 40));
    if ((cn && cn !== s.name) || day !== s.day) act("meta", { name: cn || s.name, day });
    else render();
    M.toast("Saved.");
  };
  view.querySelectorAll("[data-switch]").forEach(b => b.onclick = () => { activeId = b.dataset.switch; LS.set("marqueeClubActive", activeId); live(); render(); pull(activeId).then(render); });
  $("cbNew").onclick = () => { showStart = true; render(); };
  $("cbLeave").onclick = () => {
    if (!confirm(`Remove ${s.name || c.name} from this device? You can rejoin with the invite link.`)) return;
    LS.set("marqueeClubs", clubs().filter(x => x.id !== c.id)); try { localStorage.removeItem(evKey(c.id)); } catch {}
    delete store[c.id]; activeId = clubs()[0]?.id || null; LS.set("marqueeClubActive", activeId); live(); render();
  };
}

// Marking something as seen asks for a quick score and review; whoever suggested it to you gets told.
function titleBySk(s, sk) {
  const all = [...[...s.wl.values()].map(w => w.m), ...s.sugs.map(g => g.m), ...[...s.outs.values()].map(o => o.m), ...Object.values(s.picks), ...Object.values(s.mon).flatMap(mo => [mo.pick, ...mo.noms.map(n => n.m)]).filter(Boolean)];
  return all.find(m => seenKey(m.n) === sk) || [...(s.saw[sk]?.values() || [])].find(x => x.m)?.m || null;
}
// My watched list: the date I watched it (picked in the review sheet), else the day I tapped Watched. Bulk imports without a date don't count.
const watchedOn = x => x.old ? "" : x.d || (x.imp ? "" : iso(new Date(x.at || 0)));
function myWatched(s, who = me.id) {
  const out = [];
  for (const [sk, mp] of Object.entries(s.saw)) { const x = mp.get(who); if (!x?.v) continue; const m = titleBySk(s, sk); if (!m) continue;
    const ss = ssList(x.ss);
    if (ss.length) { const byDay = {}; for (const n of ss) if (x.ss[n]) (byDay[x.ss[n]] ||= []).push(n); for (const [d, ns] of Object.entries(byDay)) out.push({ sk, m, d, s: x.s, x: x.x, ss: ns }); continue; }
    const d = watchedOn(x); if (d) out.push({ sk, m, d, s: x.s, x: x.x }); }
  return out.sort((a, b) => b.d.localeCompare(a.d));
}
let mwYear = new Date().getFullYear(), mwAll = false, mwWho = "";
function myWatchedCard(s) {
  const ppl = [...s.members.entries()].filter(([id]) => id !== me.id && myWatched(s, id).length);
  if (mwWho && !ppl.some(([id]) => id === mwWho)) mwWho = "";
  const who = mwWho || me.id, whoName = mwWho ? s.members.get(mwWho)?.name || "They" : "";
  const all = myWatched(s, who), years = [...new Set([new Date().getFullYear(), ...all.map(w => +w.d.slice(0, 4))])].sort((a, b) => b - a);
  if (!years.includes(mwYear)) mwYear = years[0];
  const list = all.filter(w => +w.d.slice(0, 4) === mwYear), shown = mwAll ? list : list.slice(0, 15);
  const films = list.filter(w => w.m.t !== "tv").length, series = list.length - films;
  let lastMo = "";
  const rows = shown.map(w => {
    const mo = w.d.slice(0, 7), head = mo !== lastMo ? `<h5 class="mw-mo">${esc(new Date(w.d + "T12:00").toLocaleDateString(undefined, { month: "long" }))}</h5>` : ""; lastMo = mo;
    return `${head}<div class="mw-i" data-open="${esc(key(w.m))}"><span class="mw-d"><b>${+w.d.slice(8)}</b><small>${esc(new Date(w.d + "T12:00").toLocaleDateString(undefined, { weekday: "short" }))}</small></span>${poster(w.m.p, "w92")}<div class="body"><b>${esc(w.m.n)}${w.m.y ? ` <small>${esc(w.m.y)}</small>` : ""}${w.m.t === "tv" ? ` <span class="tv-tag">${w.ss ? esc(ssLabel(w.ss)) : "Series"}</span>` : ""}</b>${w.s ? `<span class="stars">${starStr(w.s)}</span>` : ""}${w.x ? `<small class="hint">“${esc(w.x)}”</small>` : ""}</div></div>`;
  }).join("");
  return `<div class="fr-card" data-tab="mine" id="mwCard">
    <div class="wl-head"><h3>${whoName ? `${esc(whoName)}'s watched list` : "My watched list"}</h3>${whoName ? "" : `<button class="primary" id="mwLog">+ Log</button>`}</div>
    ${ppl.length ? `<div class="wl-views">${[["", "Me"], ...ppl.map(([id, m]) => [id, m.name])].map(([id, n]) => `<button class="chip${id === mwWho ? " on" : ""}" data-mww="${esc(id)}">${esc(n)}</button>`).join("")}</div>` : ""}
    ${years.length > 1 ? `<div class="wl-views">${years.map(y => `<button class="chip${y === mwYear ? " on" : ""}" data-mwy="${y}">${y}</button>`).join("")}</div>` : ""}
    <p class="hint mw-sum">${list.length ? `<b>${list.length}</b> watched in ${mwYear}${films && series ? ` · ${films} film${films === 1 ? "" : "s"}, ${series} series` : ""}` : whoName ? `${esc(whoName)} hasn't logged anything for ${mwYear}.` : `Nothing logged for ${mwYear} yet. Tap Watched? on any title, or + Log for something that isn't on a list.`}</p>
    <div class="mw-list">${rows}</div>
    ${!mwAll && list.length > shown.length ? `<button class="link" id="mwMore">Show all ${list.length}</button>` : ""}
  </div>`;
}
function openReview(s, sk, m0, opts = {}) {
  const m = titleBySk(s, sk) || m0 || null, name = m?.n || "it", today = iso(new Date());
  const prev = s.saw[sk]?.get(me.id)?.v ? s.saw[sk].get(me.id) : null, isTv = m?.t === "tv";
  let score = prev?.s || 0; const picked = new Set(ssList(prev?.ss));
  const bg = el(`<div class="sheet-bg"><div class="sheet" role="dialog" aria-label="Rate it">
    <h3>${prev ? `Update ${esc(name)}` : `How was ${esc(name)}?`}</h3>
    <div class="mstars">${[1, 2, 3, 4, 5].map(n => `<button data-s="${n}" aria-label="${n} stars">★</button>`).join("")}</div>
    <small class="hint rev-tip">Tap a star twice for a half star.</small>
    <input type="text" id="revX" maxlength="300" placeholder="Quick review (optional)" enterkeyhint="done" value="${esc(prev?.x || "")}">
    ${isTv ? `<div class="rev-ss"><small class="hint">Seasons you've watched</small><div class="ss-grid"><small class="hint">Loading seasons…</small></div></div>` : ""}
    <label class="rev-d">Just watched on <input type="date" id="revD" value="${today}" max="${today}"></label>
    ${m && s.members.size > 1 ? `<label class="rev-rec"><input type="checkbox" id="revRec"${opts.rec ? " checked" : ""}> Recommend this to your friends</label>` : ""}
    <div class="rev-btns"><button class="primary" data-when="now">Just watched</button><button data-when="old">Seen it before</button></div>${prev ? `<button class="link" id="revUn">Unwatch</button>` : ""}</div></div>`);
  document.body.appendChild(bg);
  if (isTv) M.tm(`/tv/${m.i}`).then(j => {
    const list = (j.seasons || []).map(x => x.season_number).filter(n => n > 0);
    const n = list.length ? list : Array.from({ length: j.number_of_seasons || 0 }, (_, i) => i + 1);
    const grid = bg.querySelector(".ss-grid"); if (!grid) return;
    grid.innerHTML = n.length ? n.map(k => `<button class="ss${picked.has(k) ? " on" : ""}" data-ss="${k}">S${k}</button>`).join("") + (n.length > 1 ? `<button class="link" data-ssall>all</button>` : "") : `<small class="hint">No season list for this one.</small>`;
    grid.querySelectorAll("[data-ss]").forEach(b => b.onclick = () => { const k = +b.dataset.ss; picked.has(k) ? picked.delete(k) : picked.add(k); b.classList.toggle("on", picked.has(k)); });
    grid.querySelector("[data-ssall]")?.addEventListener("click", () => { n.forEach(k => picked.add(k)); grid.querySelectorAll("[data-ss]").forEach(b => b.classList.add("on")); });
  }).catch(() => { const g = bg.querySelector(".ss-grid"); if (g) g.innerHTML = `<small class="hint">Couldn't load the seasons.</small>`; });
  let old = false;
  bg.querySelectorAll("[data-when]").forEach(b => b.onclick = () => { old = b.dataset.when === "old"; save(true); });
  bg.querySelector("#revUn")?.addEventListener("click", () => { bg.remove(); act("saw", { sk, v: 0 }); });
  const save = (withReview) => {
    const x = withReview ? bg.querySelector("#revX").value.trim().slice(0, 300) : "", sc = withReview ? score : 0;
    const rec = !!bg.querySelector("#revRec")?.checked, d = bg.querySelector("#revD").value || today;
    bg.remove();
    const from = prev || old ? [] : s.sugs.filter(g => seenKey(g.m.n) === sk && g.a !== me.id && sugTo(s, g).includes(me.id));
    const ss = {}; for (const k of picked) ss[k] = prev?.ss && k in prev.ss ? prev.ss[k] : old ? "" : d;
    const news = from.length ? { to: [...new Set(from.map(g => g.a))], title: `${me.name} watched ${name}${sc ? " " + starStr(sc, true) : ""}`, body: x || `Your suggestion${from.length > 1 ? "s" : ""} worked.` } : null;
    act("saw", { sk, v: 1, ...(old ? { old: 1 } : { d }), ...(picked.size ? { ss } : {}), ...(sc ? { s: sc } : {}), ...(x ? { x } : {}), ...(m ? { m: { t: m.t, i: m.i, n: m.n, y: m.y, p: m.p } } : {}) }, news);
    // Cancel my "Still on for…?" nudges for this title: an empty recipient list makes the sender drop it.
    for (const g of s.sugs.filter(g => seenKey(g.m.n) === sk && accAt(s, g, me.id))) window.MarqueePush?.send({ to: [], id: `acc_${g.id}_${me.id}`.replace(/[^\w]/g, "").slice(0, 60), title: "-", body: "" });
    // Recommend: it lands in everyone else's For you as a suggestion to accept.
    if (rec && m) {
      const s2 = derive(active().id), others = realIds(s2).filter(id => id !== me.id && !s2.saw[sk]?.get(id)?.v);
      act("sug", { m, to: ["*"], d: iso(new Date()), wk: 0 }, others.length ? { to: others, title: `${me.name} recommends ${m.n}${sc ? " " + starStr(sc, true) : ""}`, body: x || "Watched it and says you should too." } : null);
      M.toast(`Recommended ${m.n} to your friends.`);
    }
    if (m && (sc || x) && !old) {
      const t = el(`<div class="post-offer"><span>Saved. Share it on Instagram?</span><button class="primary">Make a post</button><button class="link" aria-label="No thanks">✕</button></div>`);
      document.body.appendChild(t); const bye = () => t.remove(); setTimeout(bye, 9000);
      t.querySelector(".link").onclick = bye;
      t.querySelector(".primary").onclick = () => { bye(); titleSheet?.remove(); M.open(m.t, m.i, m.n, { rating: sc ? sc * 2 : null, take: x }); };
    }
  };
  bg.querySelectorAll(".mstars button").forEach(b => b.onclick = () => { score = halfTap(score, +b.dataset.s); paintStars(bg, score); });
  bg.querySelector("#revX").addEventListener("keydown", e => { if (e.key === "Enter" && !e.isComposing) { old = false; save(true); } });
  bg.addEventListener("click", e => { if (e.target === bg) bg.remove(); });
  if (score) paintStars(bg, score);
  setTimeout(() => bg.querySelector(".mstars button")?.focus(), 50);
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
  e.stopPropagation(); const g = lastState.sugs.find(x => x.id === b.dataset.sugdrop); if (!g || g.a !== me.id) return;
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
  if (mine && titleBySk(lastState, b.dataset.saw)?.t !== "tv") act("saw", { sk: b.dataset.saw, v: 0 }); else openReview(lastState, b.dataset.saw);
}, true);
// Quietly keep the other clubs topped up too.
clubs().filter(c => c.id !== active()?.id).forEach(c => pull(c.id));
setInterval(() => { if (document.visibilityState === "visible") refresh(); }, 120000);
document.addEventListener("visibilitychange", () => { live(); if (document.visibilityState === "visible") refresh(); });
$("nav").addEventListener("click", e => { if (e.target.closest("[data-view=club]")) { markRead(); render(); } });
