// Movie club: a group watches one movie a week, votes on the next one and talks about it.
// No accounts and no server of our own. Every action is a small "event" that is saved on this
// device and sent to the club's private ntfy.sh topic, so everyone's copy fills in. ntfy keeps
// messages for about 12 hours, so whoever opens the club re-sends recent events the topic is
// missing. That way the club's state survives as long as any member still has it.
const M = window.Marquee;
const $ = id => document.getElementById(id);
const view = $("clubView");
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
const KINDS = new Set(["meta", "join", "nom", "drop", "vote", "pick", "unpick", "say", "seen"]);
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
    map[e.i] = e; fresh.push(e);
  }
  if (fresh.length) save(clubId);
  return fresh;
}

function derive(clubId) {
  const E = Object.values(evs(clubId)).sort((x, y) => x.t - y.t || (x.i < y.i ? -1 : 1));
  const club = clubs().find(c => c.id === clubId) || {};
  const s = { name: club.name, day: club.day ?? 0, members: new Map(), picks: {}, cur: -1, rounds: {} };
  const R = r => (s.rounds[r] ||= { noms: [], dropped: new Set(), votes: new Map(), seen: new Map(), says: [] });
  const unpickAt = {};
  for (const e of E) if (e.k === "unpick") unpickAt[e.r] = Math.max(unpickAt[e.r] || 0, e.t);
  for (const e of E) {
    s.members.set(e.a, { name: e.n || "Someone", last: e.t });
    const rd = R(e.r);
    switch (e.k) {
      case "meta": if (e.name) s.name = String(e.name).slice(0, 40); if (e.day >= 0 && e.day <= 6) s.day = e.day; break;
      case "pick": if (e.t > (unpickAt[e.r] || 0) && !s.picks[e.r]) s.picks[e.r] = { ...e.m, by: e.n, at: e.t }; break;
      case "nom": if (!rd.noms.some(n => key(n.m) === key(e.m))) rd.noms.push({ m: e.m, by: e.n, a: e.a, at: e.t }); else rd.dropped.delete(key(e.m)); break;
      case "drop": rd.dropped.add(key(e.m)); break;
      case "vote": rd.votes.set(e.a, e.v || ""); break;
      case "seen": rd.seen.set(e.a, { s: e.s || 0, name: e.n }); break;
      case "say": rd.says.push(e); break;
    }
  }
  const rs = Object.keys(s.picks).map(Number);
  s.cur = rs.length ? Math.max(...rs) : -1;
  s.round = r => R(r);
  return s;
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
  const want = all.filter(e => e === latestMeta || e.k === "pick" || e.k === "unpick" || (e.k !== "meta" && e.r >= keepFrom));
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
function openSearch(title, onPick) {
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
  setTimeout(() => q.focus(), 50);
}

// ---------- screens ----------
const openPast = new Set();
let showStart = false;
let peek = {};

function keepInputs(fn) {
  // Live updates re-draw the page; don't lose what someone is typing.
  const vals = {}; view.querySelectorAll("input[id], textarea[id]").forEach(i => vals[i.id] = i.value);
  const focus = document.activeElement?.id, pos = document.activeElement?.selectionStart;
  fn();
  Object.entries(vals).forEach(([id, v]) => { const i = $(id); if (i && i.type !== "checkbox" && v) i.value = v; });
  if (focus && $(focus)) { $(focus).focus(); try { $(focus).setSelectionRange(pos, pos); } catch {} }
}

function renderStart() {
  const inv = pendingInvite;
  view.innerHTML = `
    <h2>Movie club</h2>
    <p>Like a book club, but for movies. Every week your group watches the same movie, votes on next week's pick, and talks about it here. No accounts, nothing to install.</p>
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
  if (showStart || !me || !clubs().length || pendingInvite && !clubs().some(c => c.id === pendingInvite.id)) { renderStart(); return; }
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

function renderClub() {
  const c = active(), s = derive(c.id);
  if (s.name !== c.name || s.day !== c.day) { const l = clubs(); const x = l.find(y => y.id === c.id); x.name = s.name || x.name; x.day = s.day; LS.set("marqueeClubs", l); }
  const cur = s.cur, movie = s.picks[cur], rd = s.round(cur), cands = tally(rd);
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

  view.innerHTML = `
    <div class="fr-card">
      <div class="fr-row"><div style="flex:1;min-width:0"><h2 style="margin:0">${esc(s.name || c.name)}</h2><small class="hint">Movie night: ${DAYS[s.day]} · ${members.length} member${members.length === 1 ? "" : "s"}</small></div>
        <button id="cbInvite">Invite</button></div>
      <div class="faces">${members.map(([id, m]) => avatar(m.name, movie && rd.seen.has(id))).join("")}</div>
      <p class="hint" id="clubOffline"${online ? " hidden" : ""}>Can't reach the club right now. What you do is saved here and sent when you're back online.</p>
    </div>

    ${movie ? `<div class="fr-card">
      <div class="club-hero">${poster(movie.p, "w185")}<div class="body">
        <span class="eyebrow">This week${cur > 0 ? ` · Week ${cur + 1}` : ""}</span>
        <b class="t">${esc(movie.n)}${movie.y ? ` <small class="hint">(${esc(movie.y)})</small>` : ""}</b>
        <small class="hint">Watch it before ${esc(nightLabel(night))}</small>
        <small class="hint">${rd.seen.size ? `${rd.seen.size} of ${members.length} watched${avg ? ` · ${avg.toFixed(1)} ★ average` : ""}` : "Nobody has watched it yet"}</small>
        ${scores.length ? scoreChart(scores) : ""}
        <div class="acts" id="seenActs">
          ${seenMine ? `<span class="done">✓ You watched it${seenMine.s ? " · " + stars(seenMine.s) : ""}</span><button class="link" id="cbUnsee">Change</button>`
            : `<button class="primary" id="cbSeen">I watched it</button>`}
          <button id="cbPost">Make a post</button><button id="cbShare">Share</button>
        </div>
      </div></div>
    </div>

    <div class="fr-card">
      <h3>Discussion <small>${rd.says.length || ""}</small></h3>
      ${locked && rd.says.length ? `<p class="hint">Spoilers are hidden until you've watched it. <button class="link" id="cbPeek">Show anyway</button></p>` : ""}
      ${chatHtml(s, cur, locked)}
      ${sayBox(cur)}
    </div>` : `<div class="fr-card">
      <h3>Pick your first movie</h3>
      <p class="hint">Choose it yourself, or let everyone nominate and vote below.</p>
      <button class="primary" id="cbFirst">Choose the first movie</button>
    </div>`}

    <div class="fr-card">
      <h3>${movie ? "Vote for next week" : "Vote for the first movie"} <small>${totalVotes ? totalVotes + " vote" + (totalVotes === 1 ? "" : "s") : ""}</small></h3>
      ${cands.length && totalVotes ? voteChart(cands, totalVotes, members.length) : ""}
      ${cands.length ? cands.map((x, i) => `<div class="cand">${poster(x.m.p, "w92")}<div class="body">
          <b>${esc(x.m.n)}${x.m.y ? ` <small>(${esc(x.m.y)})</small>` : ""}</b>
          <small>Nominated by ${esc(x.a === me.id ? "you" : x.by)} · ${x.votes} vote${x.votes === 1 ? "" : "s"}${x.a === me.id && !x.votes ? ` · <button class="link" data-drop="${esc(key(x.m))}">remove</button>` : ""}</small>
          <div class="bar"><i style="width:${totalVotes ? Math.round(x.votes / totalVotes * 100) : 0}%;background:${CHART[i % CHART.length]}"></i></div>
        </div><button class="vote${myVote === key(x.m) ? " on" : ""}" data-vote="${esc(key(x.m))}">${myVote === key(x.m) ? "✓ Voted" : "Vote"}</button></div>`).join("")
        : `<p class="hint">No nominations yet. Add a movie you'd like the group to watch${movie ? " next" : ""}.</p>`}
      <div class="row-btns" style="display:flex;gap:8px;flex-wrap:wrap">
        <button id="cbNom">+ Nominate a movie</button>
        ${cands.length ? `<button id="cbAskVote">Ask the group to vote</button>` : ""}
      </div>
      ${cands.length ? `<button class="primary" id="cbLock">Lock in ${esc(cands[0].m.n)}${movie ? " for next week" : ""}</button>
        <p class="hint">Do this on movie night once everyone has voted. Most votes wins; a tie goes to whatever was nominated first.</p>` : ""}
    </div>

    ${past.length ? `<div class="fr-card">
      <h3>Past movies <small>${past.length}</small></h3>
      ${past.map(r => {
        const m = s.picks[r], prd = s.round(r), sc = [...prd.seen.values()].map(x => x.s).filter(Boolean);
        const a = sc.length ? (sc.reduce((x, y) => x + y, 0) / sc.length).toFixed(1) + " ★" : "";
        return `<details data-past="${r}"${openPast.has(r) ? " open" : ""}><summary class="past">${poster(m.p, "w92")}<span class="body"><b>${esc(m.n)}</b><small>Week ${r + 1} · ${prd.seen.size} watched${a ? " · " + a : ""} · ${prd.says.length} comment${prd.says.length === 1 ? "" : "s"}</small></span></summary>
          ${chatHtml(s, r, false)}${sayBox(r)}</details>`;
      }).join("")}
    </div>` : ""}

    <div class="fr-card">
      <details class="more"><summary>Club settings</summary>
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
          <button class="link" id="cbLeave">Leave this club on this device</button>
        </div>
      </details>
    </div>`;

  bind(c, s, cands, movie);
}

function bind(c, s, cands, movie) {
  const cur = s.cur;
  $("cbInvite").onclick = () => shareInvite({ ...c, name: s.name || c.name, day: s.day });
  $("cbFirst")?.addEventListener("click", () => openSearch("Choose the first movie", m => act("pick", { r: 0, m }, { title: `First movie: ${m.n}`, body: `Watch it before ${nightLabel(nightAfter(now(), s.day))}.` })));
  $("cbNom").onclick = () => openSearch(movie ? "Nominate for next week" : "Nominate the first movie", m => {
    const rd = s.round(cur);
    if (tally(rd).some(x => key(x.m) === key(m))) { M.toast(`${m.n} is already nominated.`); return; }
    act("nom", { m }, { title: `${me.name} nominated ${m.n}`, body: "Open the club to vote." });
    if (!s.round(cur).votes.get(me.id)) setTimeout(() => act("vote", { v: key(m) }), 50);
  });
  $("cbAskVote")?.addEventListener("click", () => {
    const list = cands.map(x => `• ${x.m.n} (${x.votes})`).join("\n");
    shareText(`Vote for ${movie ? "next week's" : "our first"} movie club pick:\n${list}\nVote here:`, APP_URL + "?view=club");
  });
  $("cbLock")?.addEventListener("click", () => {
    const w = cands[0];
    if (!confirm(`Lock in ${w.m.n} as ${movie ? "next week's" : "the first"} movie? This starts a new week for everyone.`)) return;
    act("pick", { r: cur + 1, m: w.m }, { title: `Next movie: ${w.m.n}`, body: `${w.votes} vote${w.votes === 1 ? "" : "s"}. Watch it before ${nightLabel(nightAfter(now(), s.day))}.` });
  });
  view.querySelectorAll("[data-vote]").forEach(b => b.onclick = () => act("vote", { v: s.round(cur).votes.get(me.id) === b.dataset.vote ? "" : b.dataset.vote }));
  view.querySelectorAll("[data-drop]").forEach(b => b.onclick = () => { const x = cands.find(y => key(y.m) === b.dataset.drop); if (x) act("drop", { m: x.m }); });
  $("cbPost")?.addEventListener("click", () => M.open(movie.t, movie.i, movie.n));
  $("cbShare")?.addEventListener("click", () => shareText(`This week in ${s.name || "our movie club"}: ${movie.n}${movie.y ? ` (${movie.y})` : ""}. Watch it before ${nightLabel(nightAfter(movie.at, s.day))}, then tell us what you thought:`, APP_URL + "?view=club"));
  $("cbPeek")?.addEventListener("click", () => { peek[cur] = true; render(); });
  $("cbUnsee")?.addEventListener("click", () => openSeen(s, movie));
  $("cbSeen")?.addEventListener("click", () => openSeen(s, movie));
  const sendSay = r => {
    const i = $("say_" + r), x = i.value.trim(); if (!x) return;
    i.value = "";
    const m = s.picks[r];
    act("say", { r, x }, { title: `${me.name} on ${m?.n || "the movie"}`, body: x.slice(0, 200) });
  };
  view.querySelectorAll("[data-say]").forEach(b => b.onclick = () => sendSay(+b.dataset.say));
  view.querySelectorAll(".say input").forEach(i => i.addEventListener("keydown", e => { if (e.key === "Enter" && !e.isComposing) sendSay(+i.id.slice(4)); }));
  view.querySelectorAll("details[data-past]").forEach(d => d.addEventListener("toggle", () => { const r = +d.dataset.past; d.open ? openPast.add(r) : openPast.delete(r); }));
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
// Quietly keep the other clubs topped up too.
clubs().filter(c => c.id !== active()?.id).forEach(c => pull(c.id));
setInterval(() => { if (document.visibilityState === "visible") refresh(); }, 120000);
document.addEventListener("visibilitychange", () => { live(); if (document.visibilityState === "visible") refresh(); });
$("nav").addEventListener("click", e => { if (e.target.closest("[data-view=club]")) { markRead(); render(); } });
