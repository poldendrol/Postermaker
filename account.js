// Optional account: log in with email and password to keep Marquee the same on every device.
// Runs only when firebase-config.js sets window.MARQUEE_ACCOUNT. Without it, Marquee works as before (this device only).
// What syncs: your club identity and clubs (with their history and watchlist), your watchlist, posts history, ratings and settings.
// It's all copied into one private Firestore document, sync/{uid}, that only you can read (see firestore.rules).
const cfg = window.MARQUEE_ACCOUNT;
const box = document.getElementById("acct");
const M = window.Marquee;
const V = "10.12.2", CDN = `https://www.gstatic.com/firebasejs/${V}/`;
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const toast = t => (M?.toast || alert)(t);

const FIXED = ["marqueeClubMe", "marqueeMe", "marqueeClubs", "marqueeClubActive", "marqueeWatchlist", "marqueeHistory", "marqueeTop",
  "marqueeRatings", "marqueePrefs", "marqueeCinemasOff", "marqueeMyServices", "handle", "marqueeFriends", "marqueeSent", "marqueeInbox"];
const IDENTITY = new Set(["marqueeClubMe", "marqueeMe"]); // the same "you" everywhere: the account's copy wins
const synced = k => FIXED.includes(k) || k.startsWith("marqueeClubEv_");
const raw = k => { try { return localStorage.getItem(k); } catch { return null; } };
const setRaw = Storage.prototype.setItem;
const write = (k, v) => { try { setRaw.call(localStorage, k, v); } catch {} };
const parse = s => { try { return JSON.parse(s); } catch { return s; } };
const DEV = (() => { let d = sessionStorage.getItem("marqueeDev"); if (!d) { d = Math.random().toString(36).slice(2, 10); try { sessionStorage.setItem("marqueeDev", d); } catch {} } return d; })();

// Club histories can get big (imports add hundreds of events), so they're gzipped to fit Firestore's 1 MB document limit.
const GZ = "gz1:", canGz = typeof CompressionStream === "function";
const b64e = u8 => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
const gz = async str => canGz ? GZ + b64e(new Uint8Array(await new Response(new Blob([str]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer())) : str;
const gunz = async v => typeof v === "string" && v.startsWith(GZ) ? await new Response(new Blob([Uint8Array.from(atob(v.slice(GZ.length)), c => c.charCodeAt(0))]).stream().pipeThrough(new DecompressionStream("gzip"))).text() : v;

// Combine this device's copy with the account's copy without losing anything from either side.
const idOf = x => x && typeof x === "object" ? (x.id != null ? `${x.type || ""}:${x.id}` : x.key ?? x.at ?? x.t ?? JSON.stringify(x)) : JSON.stringify(x);
function mergeVal(k, local, remote) {
  if (remote == null) return local;
  if (local == null || IDENTITY.has(k)) return remote;
  const a = parse(local), b = parse(remote);
  if (Array.isArray(a) && Array.isArray(b)) {
    const seen = new Set(a.map(idOf));
    return JSON.stringify([...a, ...b.filter(x => !seen.has(idOf(x)))]);
  }
  if (a && b && typeof a === "object" && typeof b === "object") return JSON.stringify({ ...b, ...a }); // events by id; settings: this device wins
  return local;
}

if (box && cfg && cfg.apiKey) start().catch(e => { console.error(e); box.innerHTML = `<b>Account</b><p class="hint">Accounts couldn't load. Check your connection and refresh.</p>`; });

async function start() {
  box.hidden = false; box.innerHTML = `<b>Account</b><p class="hint">Loading…</p>`;
  const [{ initializeApp }, A, F] = await Promise.all([import(CDN + "firebase-app.js"), import(CDN + "firebase-auth.js"), import(CDN + "firebase-firestore.js")]);
  const app = initializeApp(cfg, "marquee-account");
  const auth = A.getAuth(app), db = F.getFirestore(app);
  let user = null, unsub = null, timer = null, busy = false, stale = false;

  const snapshot = async () => { const d = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (synced(k)) d[k] = raw(k); } for (const k of Object.keys(d)) if (k.startsWith("marqueeClubEv_") && d[k]?.length > 2000) { try { d[k] = await gz(d[k]); } catch {} } return d; };
  const push = async () => {
    if (!user) return; clearTimeout(timer); timer = null;
    const d = await snapshot(), size = Object.values(d).reduce((n, v) => n + (v?.length || 0), 0);
    if (size > 900000) { console.warn("Marquee sync: too big, leaving out the largest club histories"); for (const k of Object.keys(d).filter(k => k.startsWith("marqueeClubEv_")).sort((a, b) => d[b].length - d[a].length)) { if (Object.values(d).reduce((n, v) => n + (v?.length || 0), 0) <= 900000) break; delete d[k]; } }
    try { await F.setDoc(F.doc(db, "sync", user.uid), { d, dev: DEV, t: Date.now() }); setStatus(); } catch (e) { console.error(e); setStatus("Couldn't save to your account. It'll try again."); }
  };
  // Save automatically shortly after anything worth syncing changes.
  Storage.prototype.setItem = function (k, v) { setRaw.call(this, k, v); if (this === localStorage && user && synced(k) && !busy) { clearTimeout(timer); timer = setTimeout(push, 2500); } };
  addEventListener("pagehide", () => { if (timer) push(); });

  const apply = async remote => {
    const plain = {};
    for (const [k, v] of Object.entries(remote || {})) { if (!synced(k)) continue; try { plain[k] = await gunz(v); } catch (e) { console.error(e); } }
    busy = true; let changed = false;
    try {
      for (const [k, v] of Object.entries(plain)) {
        const cur = raw(k), next = mergeVal(k, cur, v);
        if (next != null && next !== cur) { write(k, next); changed = true; }
      }
    } finally { busy = false; }
    return changed;
  };

  A.onAuthStateChanged(auth, async u => {
    unsub?.(); unsub = null; user = u; render();
    if (!u) return;
    const ref = F.doc(db, "sync", u.uid);
    let first = true;
    unsub = F.onSnapshot(ref, async snap => {
      const data = snap.exists() ? snap.data() : null;
      if (first) {
        first = false;
        const changed = await apply(data?.d);
        push();
        if (changed && !sessionStorage.getItem("marqueeSyncReloaded")) { try { sessionStorage.setItem("marqueeSyncReloaded", "1"); } catch {} toast("Synced with your account."); setTimeout(() => location.reload(), 700); }
        return;
      }
      if (data && data.dev !== DEV && await apply(data.d)) { stale = true; if (document.hidden) location.reload(); else setStatus("Updated from another device. It shows the next time you open Marquee."); }
    }, e => { console.error(e); setStatus("Couldn't reach your account."); });
  });
  document.addEventListener("visibilitychange", () => { if (stale && document.visibilityState === "visible") location.reload(); });

  function setStatus(t) { const n = box.querySelector(".acct-st"); if (n) n.textContent = t || "Everything is saved to your account."; }
  function render() {
    if (user) {
      box.innerHTML = `<b>Account</b><p class="acct-me">Logged in as <b>${esc(user.email)}</b></p><p class="hint acct-st">Everything is saved to your account.</p>
        <p class="hint">Log in with the same email on your other phone or computer and your clubs, watchlist and posts come along.</p>
        <button id="acctOut">Log out</button>`;
      box.querySelector("#acctOut").onclick = async () => { await push(); await A.signOut(auth); try { sessionStorage.removeItem("marqueeSyncReloaded"); } catch {} toast("Logged out. Your stuff stays on this device too."); };
      return;
    }
    box.innerHTML = `<b>Account</b><p class="hint">Log in to keep your clubs, watchlist and posts on all your devices.</p>
      <form id="acctForm" autocomplete="on">
        <label>Email <input type="email" id="acctEmail" autocomplete="email" required></label>
        <label>Password <input type="password" id="acctPw" autocomplete="current-password" minlength="6" required></label>
        <div class="row-btns"><button class="primary" type="submit" data-m="in">Log in</button><button type="submit" data-m="up">Create account</button></div>
        <button class="link" type="button" id="acctForgot">Forgot password?</button>
        <p class="hint acct-err" hidden></p>
      </form>`;
    const f = box.querySelector("#acctForm"), err = box.querySelector(".acct-err");
    let mode = "in";
    f.querySelectorAll("[data-m]").forEach(b => b.onclick = () => { mode = b.dataset.m; });
    const fail = e => { err.hidden = false; err.textContent = ({
      "auth/invalid-credential": "That email and password don't match. Try again, or tap Forgot password.", "auth/wrong-password": "That password isn't right.",
      "auth/user-not-found": "There's no account with that email yet. Tap Create account.", "auth/email-already-in-use": "That email already has an account. Tap Log in.",
      "auth/weak-password": "Pick a password of at least 6 characters.", "auth/invalid-email": "That email doesn't look right.",
      "auth/too-many-requests": "Too many tries. Wait a minute and try again.", "auth/network-request-failed": "No connection. Try again." }[e.code] || "Something went wrong. Try again."); };
    f.onsubmit = async e => {
      e.preventDefault(); err.hidden = true;
      const email = f.querySelector("#acctEmail").value.trim(), pw = f.querySelector("#acctPw").value;
      try { mode === "up" ? await A.createUserWithEmailAndPassword(auth, email, pw) : await A.signInWithEmailAndPassword(auth, email, pw); toast(mode === "up" ? "Account created. Your stuff is now saved." : "Logged in."); }
      catch (x) { fail(x); }
    };
    box.querySelector("#acctForgot").onclick = async () => {
      const email = f.querySelector("#acctEmail").value.trim();
      if (!email) { err.hidden = false; err.textContent = "Type your email first, then tap Forgot password."; return; }
      try { await A.sendPasswordResetEmail(auth, email); err.hidden = false; err.textContent = `We sent a reset link to ${email}.`; } catch (x) { fail(x); }
    };
  }
}
