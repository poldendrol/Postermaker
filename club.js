// Movie club: a group watches one movie a week, votes on the next one and talks about it.
// No accounts and no server of our own. Every action is a small "event" that is saved on this
// device and sent to the club's private ntfy.sh topic, so everyone's copy fills in. ntfy keeps
// messages for about 12 hours, so whoever opens the club re-sends recent events the topic is
// missing. That way the club's state survives as long as any member still has it.
const M = window.Marquee;
const $ = id => document.getElementById(id);
const view = $("clubView"), hist = $("histView");
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
  const others = who.filter(([a]) => a !== me.id).map(([, x]) => x.name);
  return `<button class="seen-tag${mine ? " on" : ""}" data-saw="${esc(k)}" aria-pressed="${mine}" title="${esc(who.length ? "Seen by " + who.map(([a, x]) => a === me.id ? "you" : x.name).join(", ") : "Tap if you've already seen it")}">${mine ? (undo ? "Unsee" : "✓ Seen") : "Seen?"}</button>`;
}
const monthOf = d => d.getFullYear() * 12 + d.getMonth();
const monthName = r => new Date(Math.floor(r / 12), r % 12, 1, 12).toLocaleDateString(undefined, { month: "long" });
// IMDb has no public API for writing lists, so the next best thing: a link to mark it there yourself.
const imdbUrl = m => /^tt\d+$/.test(m.im || "") ? `https://www.imdb.com/title/${m.im}/` : `https://www.imdb.com/find/?q=${encodeURIComponent(m.n + (m.y ? " " + m.y : ""))}&s=tt`;
const imdbLink = m => `<a class="link imdb-l" href="${esc(imdbUrl(m))}" target="_blank" rel="noopener" title="Open on IMDb to mark it there">IMDb ↗</a>`;
const scLabel = sc => { if (!sc || !sc.d) return sc?.c || ""; const [y, m, d] = sc.d.split("-").map(Number); return `${sc.c} · ${new Date(y, m - 1, d, 12).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}${sc.h ? " " + sc.h : ""}`; };
const stars = n => n ? "★".repeat(Math.round(n)) + "☆".repeat(5 - Math.round(n)) : "";

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
const KINDS = new Set(["meta", "join", "nom", "drop", "vote", "pick", "unpick", "say", "seen", "go", "saw", "wl", "wldrop", "sug"]);
// "sug" { m, to: [member ids] or ["*"] for everyone, d: "YYYY-MM-DD" first watch date, wk: 1 = remind weekly until seen }
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
  const s = { name: club.name, day: club.day ?? 0, members: new Map(), picks: {}, cur: -1, rounds: {}, mon: {}, saw: {}, wl: new Map(), sugs: [], talk: {} };
  const R = r => (s.rounds[r] ||= { noms: [], dropped: new Set(), votes: new Map(), seen: new Map(), says: [] });
  const unpickAt = {};
  for (const e of E) if (e.k === "unpick" && e.tr !== "m") unpickAt[e.r] = Math.max(unpickAt[e.r] || 0, e.t);
  for (const e of E) {
    s.members.set(e.a, { name: e.n || "Someone", last: e.t });
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
      case "wl": if (e.m) { const k = key(e.m), w = s.wl.get(k) || { m: e.m, adders: new Map(), at: e.t }; w.adders.set(e.a, e.n || "Someone"); s.wl.set(k, w); } break;
      case "wldrop": if (e.m) s.wl.get(key(e.m))?.adders.delete(e.a); break;
      case "saw": if (e.sk) (s.saw[e.sk] ||= new Map()).set(e.a, { v: !!e.v, name: e.n, at: e.t }); break;
    }
  }
  for (const [k, w] of s.wl) if (!w.adders.size) s.wl.delete(k);
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
  const want = all.filter(e => e === latestMeta || e.k === "pick" || e.k === "unpick" || e.k === "wl" || e.k === "wldrop" || e.k === "saw" || e.k === "sug" || (e.k === "say" && e.sk) || (e.k !== "meta" && e.r >= keepFrom));
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
    if (news) post({ topic: newsTopic(c.id), title: `${s.name || "Movie club"}: ${news.title}`, message: news.body || "Tap to open the club.", click: APP_URL + "?view=club", tags: ["clapper"] }).catch(() => {});
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
    if (news) post({ topic: newsTopic(c.id), title: `${s.name || "Movie club"}: ${news.title}`, message: news.body || "Tap to open the club.", click: APP_URL + "?view=club", tags: ["clapper"] }).catch(() => {});
  } catch { M.toast("Saved here. It'll reach the club when you're back online."); }
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
function openSearch(title, onPick, initial = "") {
  const bg = el(`<div class="sheet-bg"><div class="sheet" role="dialog" aria-label="${esc(title)}">
    <h3>${esc(title)}</h3>
    <input type="search" id="clubQ" placeholder="Search a movie or series" autocomplete="off">
    <div class="results" id="clubRes"><p class="hint">Start typing a title.</p></div>
    <button id="clubCancel">Cancel</button></div></div>`);
  document.body.appendChild(bg);
  const close = () => bg.remove();
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
      <label>Movie night (when you discuss) <select id="cbDay">${DAYS.map((d, i) => `<option value="${i}"${i === 0 ? " selected" : ""}>${d}</option>`).join("")}</select></label>
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
    const name = $("cbClub").value.trim() || "Movie club", day = +$("cbDay").value;
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

function render() {
  badge();
  if (showStart || !me || !clubs().length || pendingInvite && !clubs().some(c => c.id === pendingInvite.id)) {
    renderStart();
    hist.innerHTML = `<div class="fr-card"><h3>No history yet</h3><p class="hint">Start or join a movie club, and every movie the group votes on shows up here.</p><button class="primary" id="hsGo">Go to the club</button></div>`;
    $("hsGo").onclick = () => M.setView("club");
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
async function loadKp() {
  const seen = new Set(), out = [];
  for (const [path, page] of [["/movie/now_playing", 1], ["/movie/now_playing", 2], ["/movie/upcoming", 1], ["/movie/upcoming", 2]]) {
    try {
      const j = await M.tm(path, { region: "BE", language: "nl-BE", page });
      for (const x of j.results || []) if (x.release_date && !seen.has(x.id)) { seen.add(x.id); out.push({ d: x.release_date, m: { t: "movie", i: x.id, n: x.title, y: x.release_date.slice(0, 4), p: x.poster_path || "" } }); }
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
function cineHtml(dayIso) {
  if (!cine && !kp.length) return "";
  const off = cineOff();
  const have = new Set((cine?.screenings || []).map(chipOf)); if (kp.length) have.add("Kinepolis Gent");
  const opens = kpOpening(dayIso), running = kpRunning(dayIso);
  const kpFilm = (f, tag) => `<div class="cine-f"><span class="ct">${tag}</span><a href="${esc(KP_URL)}" target="_blank" rel="noopener">${esc(f.m.n)}</a><span class="cf-acts"><button class="link" data-cn="${esc(JSON.stringify({ c: "Kinepolis Gent", d: dayIso, t: f.m.n, u: KP_URL, h: [] }))}" title="Suggest for cinema night" aria-label="Suggest for cinema night">+🎟</button></span></div>`;
  const kpHtml = opens.length || running.length ? `<div class="cine-c"><span class="cine-name">Kinepolis Gent <small class="hint">times on Kinepolis</small></span>${opens.map(f => kpFilm(f, "Opens")).join("")}${running.slice(0, kpAll ? 99 : 8).map(f => kpFilm(f, "Showing")).join("")}${!kpAll && running.length > 8 ? `<button class="link" id="kpMore">+ ${running.length - 8} more</button>` : ""}</div>` : "";
  const chips = `<div class="cine-chips">${CINEMAS.filter(c => have.has(c)).map(c => `<button class="chip${off.has(c) ? "" : " on"}" data-cine="${esc(c)}" aria-pressed="${!off.has(c)}">${esc(c)}</button>`).join("")}</div>`;
  const list = cineByDay[dayIso] || [];
  if (!list.length) return `<div class="cine"><b class="cine-h">Film in Ghent</b>${chips}${kpHtml || `<small class="hint">No screenings listed for this day.</small>`}<a class="link kp-link" href="https://kinepolis.be/nl/bioscopen/kinepolis-gent" target="_blank" rel="noopener">Kinepolis Gent full programme ↗</a></div>`;
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
const sugDueToday = (g, today = iso(new Date())) => g.d === today || (g.wk && g.d < today && dayDiff(today, g.d) % 7 === 0);
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
    const nc = home ? sg.length : (cineByDay[di] || []).length + kpOpening(di).length;
    const cnt = nc ? `<i class="cnt" title="${nc} ${home ? "to watch" : "screenings in Ghent"}">${nc}</i>` : "";
    const startSg = sg.filter(g => g.d === di); // the poster only on the day it was suggested; reminders after that are just a number
    const th = e ? poster(e.m.p, "w92") : startSg.length ? poster(startSg[0].m.p, "w92") : "";
    if (!th && !nc) { cells += `<button class="cal-d${cls}" data-cal="${k}" aria-label="${esc(nightLabel(day))}"><em>${lbl}</em></button>`; continue; }
    cells += `<button class="cal-d ${e ? "ev " + e.k : startSg.length ? "ev sug" : "cn"}${cls}" data-cal="${k}" aria-label="${esc(nightLabel(day))}"><em>${lbl}</em>${th ? `<span class="th">${th}</span>` : ""}${e?.k === "cine" ? `<i class="tk" title="Cinema night">🎟</i>` : ""}${cnt}</button>`;
  }
  const fmt = d => d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const [sy, sm, sd] = st.sel.split("-").map(Number), selDay = new Date(sy, sm - 1, sd, 12), selIso = iso(selDay), e = ev[st.sel];
  let info = `<b>${esc(nightLabel(selDay))}</b>`;
  if (e?.k === "cine") info += `<span class="cn-line">🎟 <b>Cinema night:</b> ${esc(e.m.n)} · ${esc(scLabel(e.m.sc))}</span>`;
  if (e?.k === "past") info += `<span>Watched together: ${esc(e.m.n)}${e.m.y ? ` (${esc(e.m.y)})` : ""}</span>`;
  if (home) {
    const sg = sugBy[selIso] || [];
    info += sg.length ? sg.map(g => `<div class="cal-sug" data-open="${esc(key(g.m))}">${poster(g.m.p, "w92")}<span><b>${esc(g.m.n)}</b><small class="hint">${g.a === me.id ? `You → ${esc(whoLabel(s, g))}` : `From ${esc(g.by)}`} · ${g.d === selIso ? "suggested" : "weekly reminder"}</small></span></div>`).join("")
      : `<small class="hint">Nothing to watch this day. Tap a title on the club watchlist to suggest it.</small>`;
  }
  return `<div class="cal-nav"><button class="link" data-cm="-1" aria-label="Earlier weeks">‹</button><b>${fmt(start)} – ${fmt(end)}</b><button class="link" data-cm="1" aria-label="Later weeks">›</button></div>
    <div class="cal">${["M", "T", "W", "T", "F", "S", "S"].map(x => `<span class="cal-h">${x}</span>`).join("")}${cells}</div>
    <div class="cal-key">${home ? `<span><i class="k cnt">2</i>Reminders</span><span><i class="k past"></i>Watched together</span>` : `<span>🎟 Cinema night</span><span><i class="k cnt">3</i>Screenings in Ghent</span>`}</div>
    <div class="cal-info">${info}${home ? "" : cineHtml(selIso)}</div>`;
}
function bindCal(s, ev, mode) {
  const box = $(mode === "home" ? "cbCalH" : "cbCal"); if (!box) return;
  const st = CAL[mode];
  const redraw = box._redraw = () => { box.innerHTML = calHtml(s, ev, mode); bindCal(s, ev, mode); };
  box.querySelectorAll("[data-cine]").forEach(b => b.onclick = () => { const off = cineOff(), c = b.dataset.cine; off.has(c) ? off.delete(c) : off.add(c); LS.set("marqueeCinemasOff", [...off]); indexCine(); redraw(); });
  box.querySelectorAll("[data-cn]").forEach(b => b.onclick = () => { const x = JSON.parse(b.dataset.cn); pickTime(x, h => cineNominate({ c: x.c, d: x.d, h, u: x.u }, x.t)); });
  box.querySelectorAll("[data-cm]").forEach(b => b.onclick = () => { st.off += +b.dataset.cm; redraw(); });
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
  M.tm("/movie/now_playing", { region: "BE", language: "nl-BE" }).then(j => { now = (j.results || []).map(x => ({ t: "movie", i: x.id, n: x.title, y: (x.release_date || "").slice(0, 4), p: x.poster_path || "" })); drawNow(); }).catch(() => {});
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
function cinemaCard(s, members) {
  const cm = monthOf(new Date()), mo = s.mon[cm], pick = mo?.pick;
  const voteR = pick ? cm + 1 : cm, vm = s.mon[voteR], cands = tallyM(vm);
  const myVote = vm?.votes.get(me.id) || "", total = cands.reduce((a, x) => a + x.votes, 0);
  const going = pick ? [...mo.go.entries()].filter(([, g]) => g.v) : [], mine = pick ? mo.go.get(me.id) : null;
  const scPast = pick?.sc?.d && pick.sc.d < iso(new Date());
  return `<div class="fr-card pulp cinema" data-tab="monthly">
    <div class="pulp-head mon"><span class="chapter">Cinema night</span><h2 class="bang">Next outing</h2></div>
    ${pick ? `<div class="club-hero">${poster(pick.p, "w185")}<div class="body">
        <b class="t">${esc(pick.n)}${pick.y ? ` <small class="hint">(${esc(pick.y)})</small>` : ""}</b>
        ${pick.sc?.d ? `<span class="ticket-line">🎟 ${esc(scLabel(pick.sc))}</span>` : `<span class="ticket-line">📅 No date yet</span>`}
        <button class="link" id="cnDate">${pick.sc?.d ? "Change date" : "Set a date"}</button>
        <span>${pick.sc?.u ? `<a class="link" href="${esc(pick.sc.u)}" target="_blank" rel="noopener">Tickets and info</a> · ` : ""}${imdbLink(pick)}</span>
        <small class="hint">${going.length ? `Going: ${going.map(([, g]) => esc(g.name)).join(", ")}` : "Nobody has said they're going yet"}</small>
        ${scPast ? `<small class="hint">That screening has passed.</small>` : `<div class="acts">
          <button class="${mine?.v ? "on vote" : "primary"}" data-go="1">${mine?.v ? "✓ I'm going" : "I'm going"}</button>
          <button class="${mine && !mine.v ? "on vote" : ""}" data-go="0">${mine && !mine.v ? "✓ Can't make it" : "Can't make it"}</button></div>`}
      </div></div>` : ""}
    <h3 class="mon-h">Vote on ${pick ? "the outing after that" : "what we go see"} <small>${total ? total + " vote" + (total === 1 ? "" : "s") : ""}</small></h3>
    ${cands.length ? cands.map((x, i) => `<div class="cand">${poster(x.m.p, "w92")}<div class="body">
        <b>${esc(x.m.n)}${x.m.y ? ` <small>(${esc(x.m.y)})</small>` : ""}</b>
        <small>${x.sc ? "🎟 " + esc(scLabel(x.sc)) + " · " : ""}by ${esc(x.a === me.id ? "you" : x.by)} · ${x.votes} vote${x.votes === 1 ? "" : "s"} · ${imdbLink(x.m)}${x.a === me.id && !x.votes ? ` · <button class="link" data-mdrop="${esc(ckey(x))}">remove</button>` : ""}</small>
        <div class="bar"><i style="width:${total ? Math.round(x.votes / total * 100) : 0}%;background:${CHART[i % CHART.length]}"></i></div>${seenTag(x.m.n)}
      </div><button class="vote${myVote === ckey(x) ? " on" : ""}" data-mvote="${esc(ckey(x))}">${myVote === ckey(x) ? "✓ Voted" : "Vote"}</button></div>`).join("")
      : `<p class="hint">Pick a screening in a Ghent cinema (or any movie) for the group to go see together.</p>`}
    <div class="row-btns" style="display:flex;gap:8px;flex-wrap:wrap"><button id="cnSuggest">🎟 Suggest a screening</button></div>
    ${cands.length ? `<button class="primary" id="cnLock">Lock in ${esc(cands[0].m.n)}</button>` : ""}
    ${pick ? `<button class="link" id="cnUnpick">Change the pick</button>` : ""}
  </div>`;
}
function bindCinema(s) {
  const cm = monthOf(new Date()), mo = s.mon[cm], pick = mo?.pick, voteR = pick ? cm + 1 : cm, cands = tallyM(s.mon[voteR]);
  const nom = async (sc, title, m) => {
    m ||= await matchMovie(title);
    const x = { m, sc };
    if (cands.some(c => ckey(c) === ckey(x))) { M.toast("That screening is already up for the vote."); return; }
    await act("nom", { tr: "m", r: voteR, m, sc }, { title: `${me.name} suggested ${m.n} for cinema night`, body: sc ? scLabel(sc) : "Open the club to vote." });
    if (!s.mon[voteR]?.votes.get(me.id)) setTimeout(() => act("vote", { tr: "m", r: voteR, v: ckey(x) }), 50);
    M.toast(`${m.n} is up for the cinema vote.`);
  };
  cineNominate = (sc, title) => nom(sc, title);
  $("cnSuggest")?.addEventListener("click", () => openScreenings((sc, title, m) => sc ? nom(sc, title, m) : openSearch("Suggest a movie for cinema night", m => nom(null, m.n, m))));
  view.querySelectorAll("[data-mvote]").forEach(b => b.onclick = () => act("vote", { tr: "m", r: voteR, v: s.mon[voteR]?.votes.get(me.id) === b.dataset.mvote ? "" : b.dataset.mvote }));
  view.querySelectorAll("[data-mdrop]").forEach(b => b.onclick = () => { const x = cands.find(c => ckey(c) === b.dataset.mdrop); if (x) act("drop", { tr: "m", r: voteR, m: x.m, sc: x.sc }); });
  view.querySelectorAll("[data-go]").forEach(b => b.onclick = () => act("go", { tr: "m", r: cm, v: +b.dataset.go }, +b.dataset.go ? { title: `${me.name} is going to ${pick.n}`, body: scLabel(pick.sc) } : null));
  $("cnLock")?.addEventListener("click", () => {
    const w = cands[0];
    if (!confirm(`Lock in ${w.m.n} for the cinema outing?`)) return;
    act("pick", { tr: "m", r: voteR, m: w.m, sc: w.sc }, { title: `Cinema night: ${w.m.n}`, body: w.sc ? scLabel(w.sc) + ". Get your tickets!" : "Set a date in the club." });
  });
  $("cnDate")?.addEventListener("click", () => openDate(pick, sc => {
    const { sc: _o, by: _b, at: _a, ...m } = pick;
    act("pick", { tr: "m", r: cm, m, sc }, { title: `Cinema night date: ${pick.n}`, body: scLabel(sc) });
  }));
  $("cnUnpick")?.addEventListener("click", () => { if (confirm(`Take ${pick.n} off and pick again?`)) act("unpick", { tr: "m", r: cm }); });
}

// ---------- club watchlist ----------
let wlAll = false, wlQ = "", wlMsg = "", wlType = "all", wlView = "common";
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
  // Views: what nobody has seen yet (the shared list), everything, or one member's own watchlist.
  const people = [...s.members.entries()].map(([id, m]) => ({ id, name: id === me.id ? "Mine" : m.name, n: base.filter(w => w.adders.has(id)).length })).filter(p => p.n);
  if (wlView !== "common" && wlView !== "all" && !people.some(p => p.id === wlView)) wlView = "common";
  const common = base.filter(w => !seenBy(w.m.n));
  let items = wlView === "common" ? common : wlView === "all" ? base : base.filter(w => w.adders.has(wlView));
  const nTv = items.filter(w => w.m.t === "tv").length, mixed = nTv && nTv < items.length;
  items = items.filter(w => (!wlQ || w.m.n.toLowerCase().includes(wlQ)) && (!mixed || wlType === "all" || w.m.t === wlType))
    .sort((a, b) => b.adders.size - a.adders.size || b.at - a.at);
  const shown = wlAll || wlQ ? items : items.slice(0, 20);
  const person = wlView !== "common" && wlView !== "all";
  const sawBy = (t, id) => !!s.saw[seenKey(t)]?.get(id)?.v;
  const chip = (k, l, n) => `<button class="chip${wlView === k ? " on" : ""}" data-wlv="${esc(k)}">${esc(l)} <i>${n}</i></button>`;
  const row = w => {
      const mine = w.adders.has(me.id), names = [...w.adders.entries()].map(([a, n]) => a === me.id ? "you" : n);
      const sb = seenBy(w.m.n);
      return `<div class="wl-i"><button class="wl-open" data-open="${esc(key(w.m))}" aria-label="Open ${esc(w.m.n)}">${poster(w.m.p, "w92")}</button><div class="body" data-open="${esc(key(w.m))}">
        <b>${esc(w.m.n)}${w.m.y ? ` <small>${esc(w.m.y)}</small>` : ""}${w.m.t === "tv" ? ` <span class="tv-tag">Series</span>` : ""}</b>
        <small class="hint">${esc(names.slice(0, 2).join(", "))}${names.length > 2 ? ` +${names.length - 2}` : ""}${sb ? ` · seen by ${sb}` : ""} · ${imdbLink(w.m)}${mine ? ` · <button class="link" data-wldrop="${esc(key(w.m))}">remove</button>` : ""}</small>
      </div>${seenTag(w.m.n)}<button class="vote" data-sug="${esc(key(w.m))}">Suggest</button></div>`;
  };
  return `<div class="fr-card" data-tab="weekly" id="wlCard">
    <div class="wl-head"><h3>Club watchlist</h3><button class="primary" id="cwAdd">+ Add</button></div>
    <p class="hint" id="wlStatus"${wlMsg ? "" : " hidden"}>${esc(wlMsg)}</p>
    <input type="file" id="wlFile" accept=".csv,text/csv" hidden>
    ${base.length ? `<div class="wl-views">${chip("common", "Nobody's seen", common.length)}${chip("all", "Everything", base.length)}${people.map(p => chip(p.id, p.name, p.n)).join("")}</div>` : ""}
    ${mixed || items.length > 12 || wlQ ? `<div class="wl-tools">${items.length > 12 || wlQ ? `<input type="search" id="wlQ" placeholder="Filter" value="${esc(wlQ)}" autocomplete="off">` : ""}
      ${mixed ? `<span class="seg">${[["all", "All"], ["movie", "Films"], ["tv", "Series"]].map(([k, l]) => `<button class="${wlType === k ? "on" : ""}" data-wlt="${k}">${l}</button>`).join("")}</span>` : ""}</div>` : ""}
    ${person ? (() => {
      const who = wlView === me.id ? "" : esc(s.members.get(wlView)?.name || "They"), recs = items.filter(w => sawBy(w.m.n, wlView)), wants = items.filter(w => !sawBy(w.m.n, wlView));
      return `<h4 class="wl-sec">${who ? `${who} recommends` : "Seen it, recommend"} <i>${recs.length}</i></h4><div class="wl-list">${recs.map(row).join("") || `<p class="hint">${who ? "Nothing yet." : "Tap Seen? on anything you've watched and liked, or + Add › Recommend."}</p>`}</div>
        <h4 class="wl-sec">${who ? `${who} wants to watch` : "I want to watch"} <i>${wants.length}</i></h4><div class="wl-list">${wants.map(row).join("") || `<p class="hint">Nothing yet.</p>`}</div>`;
    })() : `<div class="wl-list">${shown.map(row).join("") || `<p class="hint">${base.length ? (wlView === "common" ? "Everything on the list has been seen by someone." : "Nothing here.") : "Empty for now. Tap + Add to bring in your IMDb watchlist, then tap a title to suggest it to friends."}</p>`}</div>
    ${!wlAll && !wlQ && items.length > shown.length ? `<button class="link" id="wlMore">Show all ${items.length}</button>` : ""}`}
  </div>`;
}
// ---------- suggestions (At home) ----------
function forYouCard(s) {
  const mine = sugForMe(s), sent = sugSent(s), today = iso(new Date());
  const due = mine.filter(g => sugDueToday(g, today) || (!g.wk && g.d < today));
  const row = (g, out) => {
    const rec = sugTo(s, g), done = out ? rec.length && rec.every(id => !sugOpen(s, g, id)) : !sugOpen(s, g, me.id);
    const who = rec.map(id => `<span class="who${sugOpen(s, g, id) ? "" : " ok"}">${sugOpen(s, g, id) ? "" : "✓ "}${esc(s.members.get(id)?.name || "someone")}</span>`).join("");
    const when = g.d === today ? "today" : g.d < today ? (g.wk ? DAYS[new Date(g.d + "T12:00").getDay()] + "s" : "overdue") : nightLabel(new Date(g.d + "T12:00"));
    return `<div class="wl-i sug-i${!out && due.includes(g) ? " due" : ""}${done ? " done" : ""}"><button class="wl-open" data-open="${esc(key(g.m))}">${poster(g.m.p, "w92")}${done ? `<i class="ok-badge" aria-label="${out ? "Everyone watched it" : "You watched it"}">✓</i>` : ""}</button><div class="body" data-open="${esc(key(g.m))}">
      <b>${esc(g.m.n)}${g.m.y ? ` <small>${esc(g.m.y)}</small>` : ""}${g.m.t === "tv" ? ` <span class="tv-tag">Series</span>` : ""}</b>
      ${out ? `<span class="whos">${who}</span>` : ""}<small class="hint">${[out ? (done ? "Everyone watched it" : g.to.includes("*") ? "To everyone" : "") : `From ${esc(g.by)}`,
        done ? (out ? "" : "You watched it") : g.wk ? `🔔 every ${esc(DAYS[new Date(g.d + "T12:00").getDay()])}` : `📅 ${esc(when)}`,
        (s.talk[seenKey(g.m.n)] || []).length ? `💬 ${(s.talk[seenKey(g.m.n)] || []).length}` : ""].filter(Boolean).join(" · ")}</small>
    </div>${out ? "" : seenTag(g.m.n, true)}</div>`;
  };
  return `<div class="fr-card pulp" data-tab="weekly" id="fyCard">
    <div class="pulp-head"><span class="chapter">${mine.length ? `${mine.length} to watch` : "Suggestions"}</span><h2 class="bang">For you</h2></div>
    ${due.length ? `<div class="sug-due">🔔 <b>Watch today:</b> ${due.map(g => esc(g.m.n)).join(", ")}</div>` : ""}
    <div class="wl-list">${[...mine, ...sugForMeSeen(s)].map(g => row(g, false)).join("") || `<p class="hint">Nothing suggested to you right now. When a friend suggests something, it shows up here with its reminder.</p>`}</div>
    ${!hasDemo(active().id) && s.members.size < 3 ? `<button class="fy-demo" data-demo="1">Try it out: add test friends</button>` : ""}
    ${sent.length ? `<h4 class="wl-sec">You suggested <i>${sent.length}</i></h4><div class="wl-list">${sent.map(g => row(g, true)).join("")}</div>` : ""}
  </div>`;
}
function findTitle(s, k) {
  return s.wl.get(k)?.m || s.sugs.find(g => key(g.m) === k)?.m || Object.values(s.picks).find(m => key(m) === k) || null;
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
      <small class="hint">${m.t === "tv" ? "Series · " : ""}${wl ? `On the list of ${esc([...wl.adders.entries()].map(([a, n]) => a === me.id ? "you" : n).join(", "))}` : ""}</small>
      <small class="hint">${seen.length ? `Seen by ${esc(seen.join(", "))}` : "Nobody has seen it yet"}</small>
      <span class="ts-acts">${seenTag(m.n)}${imdbLink(m)}</span></div></div>
    ${forMe.map(g => `<div class="sug-due">From ${esc(g.by)} · ${g.wk ? "every week from" : "on"} ${esc(nightLabel(new Date(g.d + "T12:00")))} <button class="link" data-ics="${esc(g.id)}">📅 Add to my calendar</button></div>`).join("")}
    <h4 class="wl-sec">Suggest it</h4>
    ${others.length ? `<div class="wl-views ts-to"><button class="chip" data-to="*">Everyone</button>${others.map(([id, x]) => `<button class="chip" data-to="${esc(id)}">${esc(x.name)}</button>`).join("")}</div>
      <small class="hint">They get a weekly reminder until they've seen it.</small>
      <button class="primary" id="tsGo" disabled>Pick who to suggest it to</button>`
      : `<p class="hint">Invite friends to the club first, then you can suggest titles to them.</p>`}
    ${sugs.length ? `<small class="hint">${sugs.map(g => `${g.a === me.id ? "You" : esc(g.by)} → ${esc(whoLabel(s, g))}`).join(" · ")}</small>` : ""}
    <h4 class="wl-sec">Talk about it <i>${talk.length || ""}</i></h4>
    <div class="ts-talk">${talk.map(e => `<p><b>${esc(e.a === me.id ? "You" : e.n)}</b> ${esc(e.x)}</p>`).join("") || `<small class="hint">No thoughts yet.</small>`}</div>
    <div class="say"><input type="text" id="tsSay" maxlength="600" placeholder="Share what you thought…" enterkeyhint="send"><button class="primary" id="tsSend">Send</button></div>
    <button id="tsClose">Close</button></div></div>`);
  document.body.appendChild(bg); titleSheet = bg;
  const to = new Set();
  const go = bg.querySelector("#tsGo");
  const sync = () => {
    bg.querySelectorAll("[data-to]").forEach(b => b.classList.toggle("on", to.has(b.dataset.to) || (b.dataset.to !== "*" && to.has("*"))));
    if (go) { go.disabled = !to.size; go.textContent = to.size ? `Suggest to ${to.has("*") ? "everyone" : [...to].map(id => s.members.get(id)?.name).join(", ")}` : "Pick who to suggest it to"; }
  };
  bg.querySelectorAll("[data-to]").forEach(b => b.onclick = () => { const id = b.dataset.to; if (id === "*") { to.has("*") ? to.clear() : (to.clear(), to.add("*")); } else { to.delete("*"); to.has(id) ? to.delete(id) : to.add(id); } sync(); });
  go?.addEventListener("click", () => {
    const d = iso(new Date()), wk = 1, list = [...to];
    const names = list.includes("*") ? "everyone" : list.map(id => s.members.get(id)?.name).join(", ");
    close(); act("sug", { m, to: list, d, wk }, { title: `${me.name} suggests ${m.n}`, body: `For ${names}. You'll get a weekly reminder until you've seen it.` });
    M.toast(`Suggested ${m.n} to ${names}.`);
  });
  const say = () => { const i = bg.querySelector("#tsSay"), x = i.value.trim(); if (!x) return; i.value = ""; act("say", { sk, x }, { title: `${me.name} on ${m.n}`, body: x.slice(0, 200) }).then(() => { const n = derive(active().id); close(); openTitle(n, m); }); };
  bg.querySelector("#tsSend").onclick = say;
  bg.querySelector("#tsSay").addEventListener("keydown", e => { if (e.key === "Enter" && !e.isComposing) say(); });
  bg.querySelectorAll("[data-ics]").forEach(b => b.onclick = () => { const g = sugs.find(x => x.id === b.dataset.ics); if (g) icsFor(g); });
  const close = () => { bg.remove(); if (titleSheet === bg) titleSheet = null; };
  bg.addEventListener("click", e => { if (e.target === bg || e.target.id === "tsClose") close(); });
  if (focusSuggest) setTimeout(() => bg.querySelector(".ts-to")?.scrollIntoView({ block: "center" }), 50);
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
  if (titles["Past Lives"]) ev(DEMO[0], "sug", { m: titles["Past Lives"], to: [me.id], d: today, wk: 1 });
  if (titles["Dune: Part Two"]) ev(DEMO[1], "sug", { m: titles["Dune: Part Two"], to: ["*"], d: isoAdd(today, 3), wk: 1 });
  if (titles["Poor Things"]) { ev(DEMO[2], "sug", { m: titles["Poor Things"], to: [me.id, "demo_jonas"], d: isoAdd(today, -7), wk: 1 }); ev(DEMO[1], "say", { sk: seenKey(titles["Poor Things"].n), x: "Saw the trailer, looks wild. Let's do it this week?" }); }
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
      wlView = me.id;
      actMany(fresh.flatMap(m => [...(have.has(key(m)) ? [] : [["wl", { m }]]), ["saw", { sk: seenKey(m.n), v: 1 }]]), { title: `${me.name} recommends ${fresh.length === 1 ? fresh[0].n : fresh.length + " titles"}`, body: label });
      M.toast(`${fresh.length === 1 ? fresh[0].n : fresh.length + " titles"} added to your recommendations.`); return;
    }
    actMany(fresh.map(m => ["wl", { m }]), { title: `${me.name} added ${fresh.length} film${fresh.length === 1 ? "" : "s"} to the club watchlist`, body: label });
    M.toast(`${fresh.length} film${fresh.length === 1 ? "" : "s"} added to the club watchlist.`);
  };
  const fromSearch = () => openSearch("Add to the club watchlist", m => addAll([m], m.n));
  view.querySelectorAll("[data-wlt]").forEach(b => b.onclick = () => { wlType = b.dataset.wlt; render(); });
  const fromSaved = () => addAll(LS.get("marqueeWatchlist", []).filter(x => x && x.id && (x.type === "movie" || x.type === "tv")).map(x => ({ t: x.type, i: x.id, n: x.title || "", y: String(x.year || ""), p: x.poster || "" })), "From their Marquee watchlist");
  let importSeen = false;
  const fromImdb = seen => { importSeen = !!seen; status(seen ? "Pick the CSV of your IMDb ratings (Your ratings › ⋯ › Export)." : "Pick the CSV you exported from IMDb (Watchlist › ⋯ › Export, then download it from IMDb's Exports page)."); $("wlFile").click(); };
  $("cwAdd")?.addEventListener("click", () => {
    const saved = LS.get("marqueeWatchlist", []).length;
    const bg = el(`<div class="sheet-bg"><div class="sheet" role="dialog" aria-label="Add to the club watchlist"><h3>Add to the club watchlist</h3>
      <h4 class="wl-sec">My IMDb watchlist</h4>
      <div class="imdb-steps"><a class="btn" href="https://www.imdb.com/list/watchlist/" target="_blank" rel="noopener" data-a="go">1 · Export on IMDb ↗</a><button class="primary" data-a="imdb">2 · Pick the file</button></div>
      <small class="hint">On IMDb tap ⋯ › Export. When it's ready, download it from <a class="link" href="https://www.imdb.com/exports/" target="_blank" rel="noopener" data-a="go">your Exports page ↗</a>, then come back and pick it.</small>
      <button data-a="search">Search a film or series</button>
      <h4 class="wl-sec">Seen it? Recommend it</h4>
      <button data-a="rec">Recommend something I've seen</button>
      <div class="imdb-steps"><a class="btn" href="https://www.imdb.com/list/ratings/" target="_blank" rel="noopener" data-a="go">1 · Export my IMDb ratings ↗</a><button data-a="rated">2 · Pick the file</button></div>
      ${saved ? `<button data-a="saved">My Marquee watchlist (${saved})</button>` : ""}
      <button data-a="x">Cancel</button></div></div>`);
    document.body.appendChild(bg);
    bg.addEventListener("click", e => { const a = e.target.closest("[data-a]")?.dataset.a; if ((e.target !== bg && !a) || a === "go") return; bg.remove(); if (a === "imdb") fromImdb(); else if (a === "rated") fromImdb(true); else if (a === "rec") openSearch("Recommend something you've seen", m => addAll([m], m.n, true)); else if (a === "search") fromSearch(); else if (a === "saved") fromSaved(); });
  });
  $("wlFile")?.addEventListener("change", async e => {
    const file = e.target.files[0]; if (!file) return;
    const rows = parseCsv(await file.text()); const head = (rows[0] || []).map(h => h.trim().toLowerCase());
    const ci = head.indexOf("const");
    if (ci < 0) { status("That doesn't look like an IMDb export. It needs the “Const” column with tt… IDs."); return; }
    const tts = [...new Set(rows.slice(1).map(r => (r[ci] || "").trim()).filter(x => /^tt\d+$/.test(x)))];
    const work = tts.slice(), ms = []; let done = 0, missed = 0;
    status(`Matching ${tts.length} IMDb titles…`);
    const worker = async () => { while (work.length) { const tt = work.shift(); try {
      const f = await M.tm("/find/" + tt, { external_source: "imdb_id" });
      const x = (f.movie_results || [])[0] || (f.tv_results || [])[0];
      if (x) ms.push({ t: x.title ? "movie" : "tv", i: x.id, n: x.title || x.name, y: (x.release_date || x.first_air_date || "").slice(0, 4), p: x.poster_path || "", im: tt }); else missed++;
    } catch { missed++; } done++; if (done % 10 === 0) status(`Matching IMDb titles… ${done} of ${tts.length}`); } };
    await Promise.all([worker(), worker(), worker(), worker()]);
    status(`${ms.length} of ${tts.length} IMDb titles found${missed ? ` (${missed} couldn't be matched)` : ""}.`);
    addAll(ms, importSeen ? "From their IMDb ratings" : "From their IMDb watchlist", importSeen); e.target.value = "";
  });
  $("wlQ")?.addEventListener("input", e => { wlQ = e.target.value.toLowerCase(); keepInputs(renderClub); });
  view.querySelectorAll("[data-wlv]").forEach(x => x.onclick = () => { wlView = x.dataset.wlv; wlAll = false; render(); });
  $("wlMore")?.addEventListener("click", () => { wlAll = true; render(); });
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
function historyHtml(s) {
  const rounds = Object.keys(s.picks).map(Number).sort((a, b) => b - a);
  const avgOf = r => { const sc = [...s.round(r).seen.values()].map(x => x.s).filter(Boolean); return sc.length ? sc.reduce((a, b) => a + b, 0) / sc.length : 0; };
  const totalVotes = rounds.reduce((n, r) => n + (r > 0 ? [...s.round(r - 1).votes.values()].filter(Boolean).length : 0), 0);
  const rated = rounds.filter(r => r < s.cur && avgOf(r)).sort((a, b) => avgOf(b) - avgOf(a));
  const best = rated[0] != null ? s.picks[rated[0]] : null;
  const head = `<div class="fr-card pulp">
    <div class="pulp-head"><span class="chapter">${esc(s.name || "Movie club")}</span><h2 class="bang">The story so far</h2></div>
    <div class="hstats"><div><b>${rounds.length}</b><small>chapter${rounds.length === 1 ? "" : "s"}</small></div><div><b>${totalVotes}</b><small>vote${totalVotes === 1 ? "" : "s"} cast</small></div><div><b>${best ? avgOf(rated[0]).toFixed(1) + "★" : "–"}</b><small>${best ? "best: " + esc(best.n) : "best rated"}</small></div></div>
  </div>`;
  if (!rounds.length) return head + `<div class="fr-card"><p class="hint">No movies yet. Once the group locks in its first pick, it lands here with how the vote went.</p></div>`;
  return head + rounds.map(r => {
    const m = s.picks[r], rd = s.round(r), a = avgOf(r), isNow = r === s.cur;
    const field = r > 0 ? tally(s.round(r - 1)) : [];
    const tv = field.reduce((n, x) => n + x.votes, 0);
    const win = field.find(x => key(x.m) === key(m));
    const rivals = field.filter(x => key(x.m) !== key(m));
    const how = r === 0 && !field.length ? `Picked by ${esc(m.by || "the club")}` : win ? `Won with ${win.votes} of ${tv} vote${tv === 1 ? "" : "s"}` : `Picked by ${esc(m.by || "the club")}`;
    const bars = field.length > 1 ? `<div class="hbars">${field.map((x, i) => `<div class="hb${key(x.m) === key(m) ? " win" : ""}"><span>${esc(x.m.n)}</span><i><em style="width:${tv ? Math.round(x.votes / tv * 100) : 0}%;background:${CHART[i % CHART.length]}"></em></i><b>${x.votes}</b></div>`).join("")}</div>` : "";
    return `<div class="fr-card hcard${isNow ? " now" : ""}">
      <div class="hrow">${poster(m.p, "w154")}<div class="body">
        <span class="chapter-tag">Chapter ${chapterWord(r + 1)}${isNow ? " · now showing" : ""}</span>
        <b class="t">${esc(m.n)}${m.y ? ` <small class="hint">(${esc(m.y)})</small>` : ""}</b>
        <small class="hint">${esc(nightLabel(nightAfter(m.at, s.day)))}</small>
        <small>${how}${rivals.length ? ` · beat ${rivals.map(x => esc(x.m.n)).join(", ")}` : ""}</small>
        <small class="hint">${rd.seen.size} watched${a ? ` · ${a.toFixed(1)} ★ from the group` : ""}</small>
      </div></div>
      ${bars}
      ${isNow ? "" : `<details data-past="${r}"${openPast.has(r) ? " open" : ""}><summary class="link">Discussion · ${rd.says.length} comment${rd.says.length === 1 ? "" : "s"}</summary>${chatHtml(s, r, false)}${sayBox(r)}</details>`}
    </div>`;
  }).join("");
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
  const cvR = s.mon[monthOf(new Date())]?.pick ? monthOf(new Date()) + 1 : monthOf(new Date());
  const cineDot = tallyM(s.mon[cvR]).length > 0 && !s.mon[cvR]?.votes.get(me.id);
  view.dataset.tab = clubTab;

  view.innerHTML = `
    <div class="fr-card">
      <div class="fr-row"><div style="flex:1;min-width:0"><h2 style="margin:0">${esc(s.name || c.name)}</h2><small class="hint">Movie night: ${DAYS[s.day]} · ${members.length} member${members.length === 1 ? "" : "s"}</small></div>
        <button id="cbInvite">Invite</button><button id="cbGear" class="gear${clubTab === "set" ? " on" : ""}" aria-label="Club settings">⚙</button></div>
      <div class="faces">${members.map(([id, m]) => avatar(m.name, movie && rd.seen.has(id))).join("")}</div>
      <p class="hint" id="clubOffline"${online ? " hidden" : ""}>Can't reach the club right now. What you do is saved here and sent when you're back online.</p>
    </div>
    <div class="club-tabs" role="tablist">${[["weekly", "At home", sugForMe(s).some(g => sugDueToday(g))], ["monthly", "At the cinema", cineDot]]
      .map(([k, l, dot]) => `<button role="tab" data-ct="${k}" aria-selected="${clubTab === k}"${dot ? ' class="dot"' : ""}>${l}</button>`).join("")}</div>
    <div class="ccol c1"><h2 class="sec-h">At home <small>suggest, watch, talk</small></h2>
    <div class="fr-card" data-tab="weekly"><h3>At home calendar</h3><div id="cbCalH">${calHtml(s, calH, "home")}</div></div>

    ${forYouCard(s)}
    ${wlCard(s, cands, myVote, movie, cur, totalVotes)}
    </div><div class="ccol c2"><h2 class="sec-h">At the cinema <small>go see it together</small></h2>
    <div class="fr-card" data-tab="monthly"><h3>Cinema calendar</h3><div id="cbCal">${calHtml(s, calC, "cine")}</div></div>
    ${cinemaCard(s, members)}



    <div class="fr-card" data-tab="set">
      <details class="more" open><summary>Club settings</summary>
        <div style="display:flex;flex-direction:column;gap:10px;margin-top:10px">
          <label>Your name <input type="text" id="cbMe" maxlength="40" value="${esc(me.name)}"></label>
          <label>Club name <input type="text" id="cbRename" maxlength="40" value="${esc(s.name || c.name)}"></label>
          <label>Movie night <select id="cbNight">${DAYS.map((d, i) => `<option value="${i}"${i === s.day ? " selected" : ""}>${d}</option>`).join("")}</select></label>
          <button id="cbSaveSet">Save</button>
          ${movie ? `<button class="link" id="cbUnpick">Wrong movie locked in? Reopen last week's vote</button>` : ""}
          <p class="hint"><b>Alerts when Marquee is closed:</b> install the free ntfy app (<a href="https://apps.apple.com/app/ntfy/id1625396347" target="_blank" rel="noopener">iPhone</a>, <a href="https://play.google.com/store/apps/details?id=io.heckel.ntfy" target="_blank" rel="noopener">Android</a>), tap + and subscribe to this code to hear about new picks, nominations and comments:</p>
          <div class="fr-row"><input type="text" readonly value="${esc(newsTopic(c.id))}" id="cbNews"><button id="cbCopyNews">Copy</button></div>
          ${others.length ? `<p class="hint">Your other clubs:</p>${others.map(o => `<button data-switch="${esc(o.id)}">Switch to ${esc(o.name)}</button>`).join("")}` : ""}
          <button id="cbNew">Start or join another club</button>
          ${hasDemo(c.id) ? `<button id="cbDemoOff">Remove test friends</button>` : `<button id="cbDemo">Add test friends (only you see them)</button>`}
          <button class="link" id="cbLeave">Leave this club on this device</button>
        </div>
      </details>
    </div>
    </div>`;

  hist.innerHTML = historyHtml(s);
  bind(c, s, cands, movie);
  bindCinema(s);
  bindCal(s, calH, "home"); bindCal(s, calC, "cine");
  bindWl(s, cands);
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
  hist.querySelectorAll("details[data-past]").forEach(d => d.addEventListener("toggle", () => { const r = +d.dataset.past; d.open ? openPast.add(r) : openPast.delete(r); }));
  $("cbDemo")?.addEventListener("click", addDemo);
  view.querySelectorAll("[data-demo]").forEach(b => b.onclick = () => { b.disabled = true; addDemo(); });
  $("cbDemoOff")?.addEventListener("click", removeDemo);
  $("cbSaveSet").onclick = () => {
    const n = $("cbMe").value.trim(), cn = $("cbRename").value.trim(), day = +$("cbNight").value;
    if (n && n !== me.name) ensureMe(n.slice(0, 40));
    if ((cn && cn !== s.name) || day !== s.day) act("meta", { name: cn || s.name, day });
    else render();
    M.toast("Saved.");
  };
  $("cbUnpick")?.addEventListener("click", () => {
    if (!confirm(`Take ${movie.n} off and reopen the vote? Votes and comments are kept.`)) return;
    act("unpick", { r: cur });
  });
  $("cbCopyNews").onclick = async () => { try { await navigator.clipboard.writeText(newsTopic(c.id)); M.toast("Copied."); } catch { $("cbNews").select(); } };
  view.querySelectorAll("[data-switch]").forEach(b => b.onclick = () => { activeId = b.dataset.switch; LS.set("marqueeClubActive", activeId); live(); render(); pull(activeId).then(render); });
  $("cbNew").onclick = () => { showStart = true; render(); };
  $("cbLeave").onclick = () => {
    if (!confirm(`Remove ${s.name || c.name} from this device? You can rejoin with the invite link.`)) return;
    LS.set("marqueeClubs", clubs().filter(x => x.id !== c.id)); try { localStorage.removeItem(evKey(c.id)); } catch {}
    delete store[c.id]; activeId = clubs()[0]?.id || null; LS.set("marqueeClubActive", activeId); live(); render();
  };
}

function openSeen(s, movie) {
  let score = s.round(s.cur).seen.get(me.id)?.s || 0;
  const bg = el(`<div class="sheet-bg"><div class="sheet" role="dialog" aria-label="Rate it">
    <h3>How was ${esc(movie.n)}?</h3>
    <div class="mstars">${[1, 2, 3, 4, 5].map(n => `<button data-s="${n}" class="${n <= score ? "on" : ""}" aria-label="${n} stars">★</button>`).join("")}</div>
    <input type="text" id="seenSay" maxlength="600" placeholder="First thoughts for the group (optional)">
    <button class="primary" id="seenGo">Done</button><button id="seenCancel">Cancel</button></div></div>`);
  document.body.appendChild(bg);
  const close = () => bg.remove();
  bg.addEventListener("click", e => { if (e.target === bg) close(); });
  bg.querySelector("#seenCancel").onclick = close;
  bg.querySelectorAll(".mstars button").forEach(b => b.onclick = () => { score = +b.dataset.s; bg.querySelectorAll(".mstars button").forEach(o => o.classList.toggle("on", +o.dataset.s <= score)); });
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
// One tap handler for every "Seen it?" tag, wherever it is drawn.
document.addEventListener("click", e => {
  const b = e.target.closest("[data-saw]"); if (!b || !lastState) return;
  e.stopPropagation();
  const mine = !!lastState.saw[b.dataset.saw]?.get(me.id)?.v;
  act("saw", { sk: b.dataset.saw, v: mine ? 0 : 1 });
}, true);
// Quietly keep the other clubs topped up too.
clubs().filter(c => c.id !== active()?.id).forEach(c => pull(c.id));
setInterval(() => { if (document.visibilityState === "visible") refresh(); }, 120000);
document.addEventListener("visibilitychange", () => { live(); if (document.visibilityState === "visible") refresh(); });
$("nav").addEventListener("click", e => { if (e.target.closest("[data-view=club]")) { markRead(); render(); } });
