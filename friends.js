// Friends: sign in, friend codes, suggestions and "watched" alerts.
// Runs only when firebase-config.js provides a config, so the rest of Marquee works without it.
const M = window.Marquee;
const cfg = window.MARQUEE_FIREBASE;
const $ = id => document.getElementById(id);
const view = $("friendsView");
const APP_URL = location.origin + location.pathname;
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const V = "10.12.2", CDN = `https://www.gstatic.com/firebasejs/${V}/`;

function el(html) { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; }

// The suggest button should still do something sensible when Friends is off.
$("suggestBtn").onclick = () => { M.setView("friends"); };

// Keep a friend invite code from a link until the person has signed in.
{
  const q = new URLSearchParams(location.search), code = q.get("friend");
  if (code) { try { localStorage.setItem("marqueePendingFriend", code.toUpperCase()); } catch {} M.setView("friends"); history.replaceState(null, "", location.pathname); }
}

if (!cfg || !cfg.apiKey) {
  // No accounts set up: use the link + ping version, which needs no setup.
  import("./lite.js").then(m => m.startLite()).catch(e => { console.error(e); view.innerHTML = `<h2>Friends</h2><p class="hint">Friends couldn't load. Refresh the page.</p>`; });
} else {
  start().catch(e => { console.error(e); view.innerHTML = `<h2>Friends</h2><p class="hint">Friends couldn't load. Check your connection and refresh.</p>`; });
}

async function start() {
  const [{ initializeApp }, A, F] = await Promise.all([
    import(CDN + "firebase-app.js"), import(CDN + "firebase-auth.js"), import(CDN + "firebase-firestore.js")
  ]);
  const app = initializeApp(cfg);
  const auth = A.getAuth(app);
  const db = F.getFirestore(app);
  if (cfg.emulator) { A.connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true }); F.connectFirestoreEmulator(db, "127.0.0.1", 8080); }
  let me = null, profile = null, friends = [], inbox = [], sent = [], unsub = [], inboxLoaded = false;

  // Finish an email-link sign-in if this page was opened from the email.
  if (A.isSignInWithEmailLink(auth, location.href)) {
    let email = ""; try { email = localStorage.getItem("marqueeEmail") || ""; } catch {}
    if (!email) email = prompt("Type your email again to finish signing in:") || "";
    if (email) { try { await A.signInWithEmailLink(auth, email, location.href); } catch (e) { M.toast("That sign-in link has expired. Ask for a new one."); } }
    history.replaceState(null, "", location.pathname); M.setView("friends");
  }
  try { await A.getRedirectResult(auth); } catch {}

  A.onAuthStateChanged(auth, async user => {
    unsub.forEach(u => u()); unsub = []; inboxLoaded = false; me = user; profile = null; friends = []; inbox = []; sent = [];
    if (!user) { renderSignedOut(); badge(); return; }
    profile = await ensureProfile(user);
    await addPendingFriend();
    listen();
    render();
  });

  // ---------- profile ----------
  const randCode = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), b => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 32]).join("");
  async function ensureProfile(user) {
    const ref = F.doc(db, "users", user.uid);
    const snap = await F.getDoc(ref);
    if (snap.exists() && snap.data().code) return snap.data();
    const name = user.displayName || (user.email || "Friend").split("@")[0];
    for (let i = 0; i < 6; i++) {
      const code = randCode();
      try {
        await F.setDoc(F.doc(db, "codes", code), { uid: user.uid });
        const p = { name, photo: user.photoURL || "", code, createdAt: F.serverTimestamp() };
        await F.setDoc(ref, p);
        return p;
      } catch (e) { /* code taken, try another */ }
    }
    throw new Error("Couldn't create a friend code");
  }

  // ---------- friends ----------
  async function addFriendByCode(raw) {
    const code = String(raw || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (code.length !== 6) { M.toast("A friend code has 6 letters and numbers."); return false; }
    if (code === profile.code) { M.toast("That's your own code."); return false; }
    const c = await F.getDoc(F.doc(db, "codes", code));
    if (!c.exists()) { M.toast("No one has that code. Check it and try again."); return false; }
    const uid = c.data().uid;
    const them = (await F.getDoc(F.doc(db, "users", uid))).data() || {};
    const batch = F.writeBatch(db);
    batch.set(F.doc(db, "users", me.uid, "friends", uid), { name: them.name || "Friend", photo: them.photo || "", since: F.serverTimestamp() });
    batch.set(F.doc(db, "users", uid, "friends", me.uid), { name: profile.name, photo: profile.photo || "", since: F.serverTimestamp() });
    await batch.commit();
    M.toast(`You and ${them.name || "your friend"} are now friends.`);
    return true;
  }
  async function addPendingFriend() {
    let code = null; try { code = localStorage.getItem("marqueePendingFriend"); localStorage.removeItem("marqueePendingFriend"); } catch {}
    if (code) { try { await addFriendByCode(code); } catch (e) { console.error(e); } }
  }
  async function removeFriend(f) {
    if (!confirm(`Remove ${f.name} from your friends?`)) return;
    const batch = F.writeBatch(db);
    batch.delete(F.doc(db, "users", me.uid, "friends", f.id));
    batch.delete(F.doc(db, "users", f.id, "friends", me.uid));
    await batch.commit();
  }

  // ---------- live data ----------
  function listen() {
    unsub.push(F.onSnapshot(F.collection(db, "users", me.uid, "friends"), s => { friends = s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => a.name.localeCompare(b.name)); render(); }));
    unsub.push(F.onSnapshot(F.query(F.collection(db, "suggestions"), F.where("to", "==", me.uid)), s => {
      const before = new Set(inbox.map(x => x.id)), first = !inboxLoaded; inboxLoaded = true;
      inbox = s.docs.map(d => ({ id: d.id, ...d.data() })).sort(byNew);
      if (!first) inbox.filter(x => !before.has(x.id) && x.status === "open").forEach(x => alertOnce("in:" + x.id, `${x.fromName} suggests ${x.title}`, x.note || "Open Marquee to see it."));
      render();
    }));
    unsub.push(F.onSnapshot(F.query(F.collection(db, "suggestions"), F.where("from", "==", me.uid)), s => {
      sent = s.docs.map(d => ({ id: d.id, ...d.data() })).sort(byNew);
      sent.filter(x => x.status === "watched" && !x.seenBySender).forEach(x => alertOnce("w:" + x.id, `${x.toName} watched ${x.title}`, [x.score ? "★".repeat(x.score) : "", x.comment ? "“" + x.comment + "”" : ""].filter(Boolean).join(" ") || "Tap to see what they thought."));
      render();
    }));
  }
  const ts = x => (x?.toMillis ? x.toMillis() : 0);
  const byNew = (a, b) => Math.max(ts(b.watchedAt), ts(b.createdAt)) - Math.max(ts(a.watchedAt), ts(a.createdAt));

  // ---------- alerts ----------
  function badge() {
    const n = me ? inbox.filter(x => x.status === "open").length + sent.filter(x => x.status === "watched" && !x.seenBySender).length : 0;
    $("navBadge").hidden = !n; $("navBadge").textContent = n > 9 ? "9+" : n;
    if ("setAppBadge" in navigator) { (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {}); }
  }
  async function alertOnce(key, title, body) {
    let seen = []; try { seen = JSON.parse(localStorage.getItem("marqueeAlerted") || "[]"); } catch {}
    if (seen.includes(key)) return;
    seen.push(key); try { localStorage.setItem("marqueeAlerted", JSON.stringify(seen.slice(-300))); } catch {}
    if (document.visibilityState === "visible") M.toast(title);
    if ("Notification" in window && Notification.permission === "granted") {
      try { const reg = await navigator.serviceWorker?.ready; if (reg) reg.showNotification(title, { body, icon: "icon-192.png", badge: "icon-192.png", tag: key, data: { url: APP_URL + "?view=friends" } }); else new Notification(title, { body, icon: "icon-192.png" }); } catch {}
    }
  }
  async function enableAlerts() {
    if (!("Notification" in window)) { M.toast(/iphone|ipad/i.test(navigator.userAgent) ? "On iPhone, add Marquee to your Home Screen first, then open it from there." : "This browser can't show notifications."); return; }
    const p = await Notification.requestPermission();
    if (p !== "granted") { M.toast("Notifications are off. You can turn them on in your browser settings."); render(); return; }
    // Push (works when the app is closed) needs a push key and the optional server function.
    if (cfg.vapidKey && "serviceWorker" in navigator) {
      try {
        const Msg = await import(CDN + "firebase-messaging.js");
        if (await Msg.isSupported()) {
          const reg = await navigator.serviceWorker.ready;
          const token = await Msg.getToken(Msg.getMessaging(app), { vapidKey: cfg.vapidKey, serviceWorkerRegistration: reg });
          if (token) await F.setDoc(F.doc(db, "users", me.uid, "private", "push"), { tokens: F.arrayUnion(token) }, { merge: true });
        }
      } catch (e) { console.warn("push token", e); }
    }
    M.toast("Alerts are on."); render();
  }

  // ---------- suggestions ----------
  async function suggest(title, toList, note) {
    const batch = F.writeBatch(db);
    toList.forEach(f => batch.set(F.doc(F.collection(db, "suggestions")), {
      from: me.uid, fromName: profile.name, to: f.id, toName: f.name,
      type: title.type, tmdbId: title.id, title: title.title, year: title.year || "", poster: title.poster || "",
      note: note || "", status: "open", seenBySender: false, createdAt: F.serverTimestamp()
    }));
    await batch.commit();
    M.toast(toList.length === 1 ? `Suggested to ${toList[0].name}.` : `Suggested to ${toList.length} friends.`);
  }
  $("suggestBtn").onclick = () => {
    const t = M.current();
    if (!me) { M.setView("friends"); M.toast("Sign in first to suggest titles to friends."); return; }
    if (!t) { M.toast("Search a title first."); return; }
    if (!friends.length) { M.setView("friends"); M.toast("Add a friend first. Share your invite link."); return; }
    const bg = el(`<div class="sheet-bg"><div class="sheet" role="dialog" aria-label="Suggest to a friend">
      <h3>Suggest ${esc(t.title)}</h3>
      <div class="pickf">${friends.map(f => `<label><input type="checkbox" value="${esc(f.id)}"> ${esc(f.name)}</label>`).join("")}</div>
      <label>Add a note (optional) <input type="text" id="sugNote" maxlength="140" placeholder="You'll love the ending"></label>
      <div class="row-btns"><button class="primary" id="sugSend">Send suggestion</button><button id="sugCancel">Cancel</button></div>
    </div></div>`);
    document.body.appendChild(bg);
    const close = () => bg.remove();
    bg.addEventListener("click", e => { if (e.target === bg) close(); });
    bg.querySelector("#sugCancel").onclick = close;
    if (friends.length === 1) bg.querySelector("input[type=checkbox]").checked = true;
    bg.querySelector("#sugSend").onclick = async () => {
      const ids = [...bg.querySelectorAll("input[type=checkbox]:checked")].map(i => i.value);
      if (!ids.length) { M.toast("Pick at least one friend."); return; }
      try { await suggest(t, friends.filter(f => ids.includes(f.id)), bg.querySelector("#sugNote").value.trim()); close(); }
      catch (e) { console.error(e); M.toast("Couldn't send. Are you still friends?"); }
    };
  };
  async function markWatched(x, score, comment) {
    await F.updateDoc(F.doc(db, "suggestions", x.id), { status: "watched", watchedAt: F.serverTimestamp(), score: score || 0, comment: comment || "" });
    M.toast(`${x.fromName} will hear that you watched it.`);
  }

  // ---------- rendering ----------
  function renderSignedOut() {
    view.innerHTML = `
      <h2>Friends</h2>
      <p>Suggest movies and series to your mates, and get a ping when they've watched them.</p>
      <div class="fr-card">
        <button class="primary" id="gIn">Sign in with Google</button>
        <div class="fr-row"><input type="email" id="emailIn" placeholder="or your email" autocomplete="email"><button id="emailGo">Email me a link</button></div>
        <p class="hint">Your posts, watchlist and history stay on this device. Signing in is only for friends and suggestions.</p>
      </div>`;
    $("gIn").onclick = async () => {
      const prov = new A.GoogleAuthProvider();
      try { await A.signInWithPopup(auth, prov); }
      catch (e) { if (e.code === "auth/popup-blocked" || e.code === "auth/operation-not-supported-in-this-environment") await A.signInWithRedirect(auth, prov); else if (e.code !== "auth/popup-closed-by-user" && e.code !== "auth/cancelled-popup-request") M.toast("Google sign-in didn't work here. Try the email link."); }
    };
    $("emailGo").onclick = async () => {
      const email = $("emailIn").value.trim(); if (!/.+@.+\..+/.test(email)) { M.toast("Type your email first."); return; }
      try { await A.sendSignInLinkToEmail(auth, email, { url: APP_URL + "?view=friends", handleCodeInApp: true }); localStorage.setItem("marqueeEmail", email); M.toast("Check your email and tap the link."); }
      catch (e) { console.error(e); M.toast("Couldn't send the email. Try Google sign-in."); }
    };
  }
  const avatar = (name, photo) => `<span class="avatar">${photo ? `<img src="${esc(photo)}" alt="" referrerpolicy="no-referrer">` : esc((name || "?")[0].toUpperCase())}</span>`;
  const poster = p => p ? `<img src="${M.IMG}w154${esc(p)}" alt="" loading="lazy">` : `<i class="ph"></i>`;
  const when = t => { const ms = ts(t); if (!ms) return ""; const h = (Date.now() - ms) / 36e5; return h < 1 ? "just now" : h < 24 ? Math.round(h) + "h ago" : Math.round(h / 24) + "d ago"; };

  function render() {
    badge();
    if (!me || !profile) return;
    const invite = `${APP_URL}?friend=${profile.code}`;
    const openIn = inbox.filter(x => x.status === "open"), doneIn = inbox.filter(x => x.status === "watched");
    const notif = "Notification" in window ? Notification.permission : "unsupported";
    view.innerHTML = `
      <div class="fr-card">
        <div class="fr-row">${avatar(profile.name, profile.photo)}<div style="flex:1;min-width:0"><b>${esc(profile.name)}</b><br><small class="hint">${esc(me.email || "")}</small></div><button class="link" id="signOut">Sign out</button></div>
        ${notif !== "granted" ? `<button id="alertsOn">${notif === "unsupported" && /iphone|ipad/i.test(navigator.userAgent) ? "Turn on alerts (add to Home Screen first)" : "Turn on alerts"}</button>` : ""}
      </div>

      <div class="fr-card">
        <h3>Suggested to you <small>${openIn.length || ""}</small></h3>
        ${openIn.length ? openIn.map(x => `
          <div class="sug new" data-id="${esc(x.id)}">${poster(x.poster)}<div class="body">
            <b>${esc(x.title)}${x.year ? ` <small>(${esc(x.year)})</small>` : ""}</b>
            <small>From ${esc(x.fromName)} · ${when(x.createdAt)}</small>
            ${x.note ? `<span class="note">“${esc(x.note)}”</span>` : ""}
            <div class="acts"><button class="primary" data-act="watched">I watched it</button><button data-act="open">Make a post</button><button data-act="wl">+ Watchlist</button><button data-act="del">Dismiss</button></div>
          </div></div>`).join("") : `<p class="hint">Nothing yet. When a friend suggests something, it shows up here.</p>`}
        ${doneIn.length ? `<details><summary class="hint">Watched (${doneIn.length})</summary>${doneIn.map(x => `<div class="sug">${poster(x.poster)}<div class="body"><b>${esc(x.title)}</b><small>From ${esc(x.fromName)} · <span class="done">✓ watched</span></small></div></div>`).join("")}</details>` : ""}
      </div>

      <div class="fr-card">
        <h3>You suggested</h3>
        ${sent.length ? sent.map(x => `
          <div class="sug${x.status === "watched" && !x.seenBySender ? " new" : ""}">${poster(x.poster)}<div class="body">
            <b>${esc(x.title)}</b>
            <small>To ${esc(x.toName)} · ${x.status === "watched" ? `<span class="done">✓ watched ${when(x.watchedAt)}</span>` : "not watched yet"}</small>
            ${x.status === "watched" && (x.score || x.comment) ? `<span class="note">${x.score ? "★".repeat(x.score) + " " : ""}${x.comment ? "“" + esc(x.comment) + "”" : ""}</span>` : ""}
          </div></div>`).join("") : `<p class="hint">After a search, tap “Suggest to a friend”. You'll get a ping when they've watched it.</p>`}
      </div>

      <div class="fr-card">
        <h3>Friends <small>${friends.length || ""}</small></h3>
        ${friends.map(f => `<div class="fr-row">${avatar(f.name, f.photo)}<span style="flex:1">${esc(f.name)}</span><button class="link" data-rm="${esc(f.id)}">Remove</button></div>`).join("") || `<p class="hint">No friends yet. Send them your invite link.</p>`}
        <p class="hint">Your friend code</p>
        <div class="fr-row"><span class="fr-code">${esc(profile.code)}</span><button class="primary" id="shareInvite">Invite a friend</button></div>
        <div class="fr-row"><input type="text" id="codeIn" placeholder="Friend's code" maxlength="8" autocapitalize="characters"><button id="codeAdd">Add</button></div>
      </div>`;

    $("signOut").onclick = () => A.signOut(auth);
    $("alertsOn")?.addEventListener("click", enableAlerts);
    $("shareInvite").onclick = async () => {
      const text = `Add me on Marquee so we can suggest movies and series to each other. My code is ${profile.code}.`;
      if (navigator.share) { try { await navigator.share({ title: "Marquee", text, url: invite }); return; } catch (e) { if (e?.name === "AbortError") return; } }
      try { await navigator.clipboard.writeText(text + " " + invite); M.toast("Invite link copied."); } catch { prompt("Send this link to your friend:", invite); }
    };
    $("codeAdd").onclick = async () => { try { if (await addFriendByCode($("codeIn").value)) $("codeIn").value = ""; } catch (e) { console.error(e); M.toast("Couldn't add that friend."); } };
    view.querySelectorAll("[data-rm]").forEach(b => b.onclick = () => removeFriend(friends.find(f => f.id === b.dataset.rm)).catch(console.error));
    view.querySelectorAll(".sug[data-id]").forEach(card => {
      const x = inbox.find(i => i.id === card.dataset.id);
      card.querySelector("[data-act=open]").onclick = () => M.open(x.type, x.tmdbId, x.title);
      card.querySelector("[data-act=del]").onclick = () => F.deleteDoc(F.doc(db, "suggestions", x.id)).catch(console.error);
      card.querySelector("[data-act=wl]").onclick = () => {
        let l = []; try { l = JSON.parse(localStorage.getItem("marqueeWatchlist") || "[]"); } catch {}
        if (!l.some(w => w.type === x.type && w.id === x.tmdbId)) { l.unshift({ type: x.type, id: x.tmdbId, title: x.title, year: x.year, poster: x.poster }); localStorage.setItem("marqueeWatchlist", JSON.stringify(l)); }
        M.toast("Saved to your watchlist.");
      };
      card.querySelector("[data-act=watched]").onclick = () => {
        const acts = card.querySelector(".acts"); let score = 0;
        acts.outerHTML = `<div class="acts" style="flex-direction:column;align-items:stretch">
          <div class="mstars">${[1, 2, 3, 4, 5].map(n => `<button data-s="${n}" aria-label="${n} stars">★</button>`).join("")}</div>
          <input type="text" class="cm" maxlength="140" placeholder="What did you think? (optional)">
          <div class="row-btns"><button class="primary" data-act="send">Tell ${esc(x.fromName)}</button></div></div>`;
        card.querySelectorAll(".mstars button").forEach(b => b.onclick = () => { score = +b.dataset.s; card.querySelectorAll(".mstars button").forEach(o => o.classList.toggle("on", +o.dataset.s <= score)); });
        card.querySelector("[data-act=send]").onclick = () => markWatched(x, score, card.querySelector(".cm").value.trim()).catch(e => { console.error(e); M.toast("Couldn't save. Try again."); });
      };
    });
    // Opening the page counts as seeing the "watched" news.
    if (document.body.dataset.view === "friends") markSeen();
  }
  let seenTimer = 0;
  function markSeen() {
    clearTimeout(seenTimer);
    seenTimer = setTimeout(() => sent.filter(x => x.status === "watched" && !x.seenBySender).forEach(x => F.updateDoc(F.doc(db, "suggestions", x.id), { seenBySender: true }).catch(() => {})), 2500);
  }
  $("nav").addEventListener("click", e => { if (e.target.closest("[data-view=friends]") && me) markSeen(); });
}
