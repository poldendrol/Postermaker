// Friends without accounts. Suggestions travel as links, and "watched" pings go through
// ntfy.sh, a free public notification relay. Everything else stays on this device.
const M = window.Marquee;
const $ = id => document.getElementById(id);
const view = $("friendsView");
const APP_URL = location.origin + location.pathname;
const NTFY = "https://ntfy.sh";
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
const when = ms => { if (!ms) return ""; const h = (now() - ms) / 36e5; return h < 1 ? "just now" : h < 24 ? Math.round(h) + "h ago" : Math.round(h / 24) + "d ago"; };
const poster = p => p ? `<img src="${M.IMG}w154${esc(p)}" alt="" loading="lazy">` : `<i class="ph"></i>`;
const avatar = name => `<span class="avatar">${esc((name || "?")[0].toUpperCase())}</span>`;

let me = LS.get("marqueeMe", null);            // { name, topic }
const friends = () => LS.get("marqueeFriends", []);   // [{ name, topic }]
const inbox = () => LS.get("marqueeInbox", []);       // suggestions to me
const sent = () => LS.get("marqueeSent", []);         // suggestions I made

function addFriend(name, topic) {
  if (!topic || (me && topic === me.topic)) return;
  const l = friends(), f = l.find(x => x.topic === topic);
  if (f) { if (name && f.name !== name) { f.name = name; LS.set("marqueeFriends", l); } return; }
  l.push({ name: name || "Friend", topic }); LS.set("marqueeFriends", l);
}

async function publish(topic, title, message, click) {
  const r = await fetch(NTFY, { method: "POST", body: JSON.stringify({ topic, title, message, click, tags: ["clapper"] }) });
  if (!r.ok) throw new Error("ntfy " + r.status);
}

// ---------- incoming ----------
function receiveSuggestion(p) {
  const l = inbox();
  if (l.some(x => x.sid === p.sid)) return false;
  l.unshift({ sid: p.sid, type: p.t, id: p.i, title: p.n, year: p.y || "", poster: p.p || "", from: p.f, fromTopic: p.r, note: p.o || "", at: now(), status: "open" });
  LS.set("marqueeInbox", l); addFriend(p.f, p.r);
  return true;
}
function receiveWatched(p) {
  const l = sent(), s = l.find(x => x.sid === p.sid);
  addFriend(p.n, p.r);
  if (!s) return false;
  s.watched = s.watched || [];
  if (s.watched.some(w => w.topic === p.r)) return false;
  s.watched.push({ name: p.n, topic: p.r, score: p.sc || 0, comment: p.c || "", at: now(), seen: false });
  LS.set("marqueeSent", l);
  return true;
}
function handleClick(url) {
  try {
    const q = new URL(url).searchParams;
    if (q.get("s")) { const p = unb64(q.get("s")); if (receiveSuggestion(p)) notify(`${p.f} suggests ${p.n}`, p.o || "Open Marquee to see it.", "s" + p.sid); }
    if (q.get("w")) { const p = unb64(q.get("w")); if (receiveWatched(p)) notify(`${p.n} watched ${p.t}`, [p.sc ? "★".repeat(p.sc) : "", p.c ? "“" + p.c + "”" : ""].filter(Boolean).join(" ") || "Tap to see.", "w" + p.sid + p.r); }
  } catch (e) { console.warn("bad message", e); }
}

// A link someone shared, opened in this browser.
const pendingLink = (() => {
  const q = new URLSearchParams(location.search);
  if (!q.get("s") && !q.get("w")) return null;
  const url = location.href; history.replaceState(null, "", location.pathname); M.setView("friends");
  return url;
})();

async function poll() {
  if (!me) return;
  const since = LS.get("marqueeNtfySince", null) || "12h";
  try {
    const r = await fetch(`${NTFY}/${me.topic}/json?poll=1&since=${encodeURIComponent(since)}`);
    if (!r.ok) return;
    const lines = (await r.text()).split("\n").filter(Boolean);
    let last = null;
    lines.forEach(line => { try { const m = JSON.parse(line); if (m.event === "message") { last = m.id; if (m.click) handleClick(m.click); } } catch {} });
    if (last) LS.set("marqueeNtfySince", last);
    render();
  } catch {}
}

// ---------- alerts ----------
async function notify(title, body, tag) {
  const seen = LS.get("marqueeAlerted", []);
  if (seen.includes(tag)) return; seen.push(tag); LS.set("marqueeAlerted", seen.slice(-300));
  if (document.visibilityState === "visible") M.toast(title);
  if ("Notification" in window && Notification.permission === "granted") {
    try { const reg = await navigator.serviceWorker?.ready; if (reg) reg.showNotification(title, { body, icon: "icon-192.png", tag, data: { url: APP_URL + "?view=friends" } }); } catch {}
  }
}
function badge() {
  const n = me ? inbox().filter(x => x.status === "open").length + sent().reduce((a, s) => a + (s.watched || []).filter(w => !w.seen).length, 0) : 0;
  $("navBadge").hidden = !n; $("navBadge").textContent = n > 9 ? "9+" : n;
  if ("setAppBadge" in navigator) (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {});
}
function markSeen() {
  const l = sent(); let changed = false;
  l.forEach(s => (s.watched || []).forEach(w => { if (!w.seen) { w.seen = true; changed = true; } }));
  if (changed) setTimeout(() => { LS.set("marqueeSent", l); badge(); }, 2500);
}

// ---------- suggest ----------
function makePayload(t, note) {
  return { sid: rand(10), t: t.type, i: t.id, n: t.title, y: t.year || "", p: t.poster || "", f: me.name, r: me.topic, o: note || "" };
}
function recordSent(p, toNames) {
  const l = sent(); l.unshift({ sid: p.sid, type: p.t, id: p.i, title: p.n, poster: p.p, to: toNames, at: now(), watched: [] }); LS.set("marqueeSent", l.slice(0, 200));
}
function openSuggest() {
  const t = M.current();
  if (!me) { M.setView("friends"); M.toast("Pick your name first."); return; }
  if (!t) { M.toast("Search a title first."); return; }
  const fl = friends();
  const bg = el(`<div class="sheet-bg"><div class="sheet" role="dialog" aria-label="Suggest to a friend">
    <h3>Suggest ${esc(t.title)}</h3>
    <label>Add a note (optional) <input type="text" id="sugNote" maxlength="140" placeholder="You'll love the ending"></label>
    <button class="primary" id="sugShare">Send as a link (WhatsApp, Messages…)</button>
    ${fl.length ? `<p class="hint">Or send it straight to friends you've swapped with before:</p>
      <div class="pickf">${fl.map(f => `<label><input type="checkbox" value="${esc(f.topic)}"> ${esc(f.name)}</label>`).join("")}</div>
      <button id="sugDirect">Send to selected friends</button>` : `<p class="hint">After a friend opens one of your links, they show up here so you can send to them directly.</p>`}
    <button id="sugCancel">Cancel</button>
  </div></div>`);
  document.body.appendChild(bg);
  const close = () => bg.remove();
  bg.addEventListener("click", e => { if (e.target === bg) close(); });
  bg.querySelector("#sugCancel").onclick = close;
  bg.querySelector("#sugShare").onclick = async () => {
    const p = makePayload(t, bg.querySelector("#sugNote").value.trim());
    const url = `${APP_URL}?s=${b64(p)}`;
    const text = `${me.name} thinks you should watch ${t.title}${p.o ? `: “${p.o}”` : ""}. Open it in Marquee and tap “I watched it” when you have.`;
    let ok = false;
    if (navigator.share) { try { await navigator.share({ title: "Marquee", text, url }); ok = true; } catch (e) { if (e?.name === "AbortError") return; } }
    if (!ok) { try { await navigator.clipboard.writeText(text + " " + url); M.toast("Link copied. Paste it to your friend."); ok = true; } catch { prompt("Send this link to your friend:", url); ok = true; } }
    recordSent(p, null); close(); render();
  };
  bg.querySelector("#sugDirect")?.addEventListener("click", async () => {
    const topics = [...bg.querySelectorAll("input[type=checkbox]:checked")].map(i => i.value);
    if (!topics.length) { M.toast("Pick at least one friend."); return; }
    const p = makePayload(t, bg.querySelector("#sugNote").value.trim());
    const to = fl.filter(f => topics.includes(f.topic));
    try {
      await Promise.all(to.map(f => publish(f.topic, `${me.name} suggests ${t.title}`, p.o || "Tap to open it in Marquee.", `${APP_URL}?s=${b64(p)}`)));
      recordSent(p, to.map(f => f.name)); close(); render();
      M.toast(to.length === 1 ? `Sent to ${to[0].name}.` : `Sent to ${to.length} friends.`);
    } catch { M.toast("Couldn't send right now. Try the link instead."); }
  });
}
$("suggestBtn").onclick = openSuggest;

async function markWatched(x, score, comment) {
  const p = { sid: x.sid, t: x.title, n: me.name, r: me.topic, sc: score || 0, c: comment || "" };
  try {
    await publish(x.fromTopic, `${me.name} watched ${x.title}`, [score ? "★".repeat(score) : "", comment ? "“" + comment + "”" : ""].filter(Boolean).join(" ") || "Tap to see in Marquee.", `${APP_URL}?w=${b64(p)}`);
  } catch { M.toast("Couldn't reach the ping service. Try again in a moment."); return; }
  const l = inbox(), it = l.find(i => i.sid === x.sid); Object.assign(it, { status: "watched", score, comment, watchedAt: now() }); LS.set("marqueeInbox", l);
  M.toast(`${x.from} will get a ping.`); render();
}

// ---------- page ----------
function renderStart() {
  view.innerHTML = `
    <h2>Friends</h2>
    <p>Suggest movies and series to your mates, and get a ping when they've watched them. No account needed.</p>
    <div class="fr-card">
      <label>Your name (friends see this) <input type="text" id="meName" maxlength="40" placeholder="e.g. Bram"></label>
      <button class="primary" id="meGo">Start</button>
    </div>`;
  $("meGo").onclick = () => {
    const name = $("meName").value.trim(); if (!name) { M.toast("Type your name first."); return; }
    me = { name, topic: "mq_" + rand(20) }; LS.set("marqueeMe", me);
    if (pendingLink) handleClick(pendingLink);
    render(); poll();
  };
}
function render() {
  badge();
  if (!me) { renderStart(); return; }
  const ib = inbox(), openIn = ib.filter(x => x.status === "open"), doneIn = ib.filter(x => x.status !== "open");
  const st = sent(), fl = friends();
  const notif = "Notification" in window ? Notification.permission : "unsupported";
  const ios = /iphone|ipad/i.test(navigator.userAgent);
  view.innerHTML = `
    <div class="fr-card">
      <div class="fr-row">${avatar(me.name)}<div style="flex:1;min-width:0"><b>${esc(me.name)}</b><br><small class="hint">Saved on this device only</small></div><button class="link" id="rename">Change name</button></div>
      ${notif !== "granted" ? `<button id="alertsOn">${notif === "unsupported" && ios ? "Turn on alerts (add to Home Screen first)" : "Turn on alerts"}</button>` : ""}
      <details class="more"><summary>Get pings even when Marquee is closed</summary>
        <p class="hint">Install the free <b>ntfy</b> app (<a href="https://apps.apple.com/app/ntfy/id1625396347" target="_blank" rel="noopener">iPhone</a>, <a href="https://play.google.com/store/apps/details?id=io.heckel.ntfy" target="_blank" rel="noopener">Android</a>), tap <b>+</b> and subscribe to this code. Keep it private: anyone with it can see your pings.</p>
        <div class="fr-row"><input type="text" readonly value="${esc(me.topic)}" id="topicBox"><button id="copyTopic">Copy</button></div>
      </details>
    </div>

    <div class="fr-card">
      <h3>Suggested to you <small>${openIn.length || ""}</small></h3>
      ${openIn.length ? openIn.map(x => `
        <div class="sug new" data-sid="${esc(x.sid)}">${poster(x.poster)}<div class="body">
          <b>${esc(x.title)}${x.year ? ` <small>(${esc(x.year)})</small>` : ""}</b>
          <small>From ${esc(x.from)} · ${when(x.at)}</small>
          ${x.note ? `<span class="note">“${esc(x.note)}”</span>` : ""}
          <div class="acts"><button class="primary" data-act="watched">I watched it</button><button data-act="open">Make a post</button><button data-act="wl">+ Watchlist</button><button data-act="del">Dismiss</button></div>
        </div></div>`).join("") : `<p class="hint">Nothing yet. When a friend sends you a Marquee link, open it and it shows up here.</p>`}
      ${doneIn.length ? `<details><summary class="hint">Watched (${doneIn.length})</summary>${doneIn.map(x => `<div class="sug">${poster(x.poster)}<div class="body"><b>${esc(x.title)}</b><small>From ${esc(x.from)} · <span class="done">✓ watched</span></small></div></div>`).join("")}</details>` : ""}
    </div>

    <div class="fr-card">
      <h3>You suggested</h3>
      ${st.length ? st.map(s => {
        const w = s.watched || [], fresh = w.some(x => !x.seen);
        return `<div class="sug${fresh ? " new" : ""}">${poster(s.poster)}<div class="body">
          <b>${esc(s.title)}</b>
          <small>${s.to ? "To " + esc(s.to.join(", ")) : "Sent as a link"} · ${when(s.at)}</small>
          ${w.length ? w.map(x => `<span><span class="done">✓ ${esc(x.name)} watched it</span>${x.score ? " " + "★".repeat(x.score) : ""}${x.comment ? ` <span class="note">“${esc(x.comment)}”</span>` : ""}</span>`).join("") : `<small>Not watched yet</small>`}
        </div></div>`;
      }).join("") : `<p class="hint">After a search, tap “Suggest to a friend”. You'll get a ping when they've watched it.</p>`}
    </div>

    <div class="fr-card">
      <h3>Friends <small>${fl.length || ""}</small></h3>
      ${fl.map(f => `<div class="fr-row">${avatar(f.name)}<span style="flex:1">${esc(f.name)}</span><button class="link" data-rm="${esc(f.topic)}">Remove</button></div>`).join("") || `<p class="hint">Friends appear here once you've swapped a suggestion, so you can send to them directly next time.</p>`}
    </div>`;

  $("rename").onclick = () => { const n = prompt("Your name:", me.name); if (n && n.trim()) { me.name = n.trim().slice(0, 40); LS.set("marqueeMe", me); render(); } };
  $("alertsOn")?.addEventListener("click", async () => {
    if (!("Notification" in window)) { M.toast(ios ? "Add Marquee to your Home Screen first, then open it from there." : "This browser can't show notifications."); return; }
    const p = await Notification.requestPermission(); M.toast(p === "granted" ? "Alerts are on." : "Alerts are off. You can turn them on in your settings."); render();
  });
  $("copyTopic").onclick = async () => { try { await navigator.clipboard.writeText(me.topic); M.toast("Copied."); } catch { $("topicBox").select(); } };
  view.querySelectorAll("[data-rm]").forEach(b => b.onclick = () => { LS.set("marqueeFriends", friends().filter(f => f.topic !== b.dataset.rm)); render(); });
  view.querySelectorAll(".sug[data-sid]").forEach(card => {
    const x = inbox().find(i => i.sid === card.dataset.sid);
    card.querySelector("[data-act=open]").onclick = () => M.open(x.type, x.id, x.title);
    card.querySelector("[data-act=del]").onclick = () => { LS.set("marqueeInbox", inbox().filter(i => i.sid !== x.sid)); render(); };
    card.querySelector("[data-act=wl]").onclick = () => {
      const l = LS.get("marqueeWatchlist", []);
      if (!l.some(w => w.type === x.type && w.id === x.id)) { l.unshift({ type: x.type, id: x.id, title: x.title, year: x.year, poster: x.poster }); LS.set("marqueeWatchlist", l); }
      M.toast("Saved to your watchlist.");
    };
    card.querySelector("[data-act=watched]").onclick = () => {
      let score = 0;
      card.querySelector(".acts").outerHTML = `<div class="acts" style="flex-direction:column;align-items:stretch">
        <div class="mstars">${[1, 2, 3, 4, 5].map(n => `<button data-s="${n}" aria-label="${n} stars">★</button>`).join("")}</div>
        <input type="text" class="cm" maxlength="140" placeholder="What did you think? (optional)">
        <div class="row-btns"><button class="primary" data-act="send">Tell ${esc(x.from)}</button></div></div>`;
      card.querySelectorAll(".mstars button").forEach(b => b.onclick = () => { score = +b.dataset.s; card.querySelectorAll(".mstars button").forEach(o => o.classList.toggle("on", +o.dataset.s <= score)); });
      card.querySelector("[data-act=send]").onclick = () => markWatched(x, score, card.querySelector(".cm").value.trim());
    };
  });
  if (document.body.dataset.view === "friends") markSeen();
}

export function startLite() {
  if (me && pendingLink) handleClick(pendingLink);
  render(); poll();
  setInterval(() => { if (document.visibilityState === "visible") poll(); }, 30000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") poll(); });
  $("nav").addEventListener("click", e => { if (e.target.closest("[data-view=friends]")) { render(); } });
}
