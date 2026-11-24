// Push notifications when Marquee is closed (Firebase Cloud Messaging, free plan, no server).
// The app queues a notification in Firestore (pushes/…); a GitHub job (scripts/push.mjs) sends the queue every few minutes.
// Phones register under their club member id (tokens/{memberId}/devices/{uid}). Off until firebase-config.js sets MARQUEE_VAPID.
const cfg = window.MARQUEE_ACCOUNT, vapid = window.MARQUEE_VAPID;
const V = "10.12.2", CDN = `https://www.gstatic.com/firebasejs/${V}/`;
const ls = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
let fb = null;
async function init() {
  if (fb) return fb;
  const [{ initializeApp }, A, F] = await Promise.all([import(CDN + "firebase-app.js"), import(CDN + "firebase-auth.js"), import(CDN + "firebase-firestore.js")]);
  const app = initializeApp(cfg, "marquee-push"), auth = A.getAuth(app);
  await auth.authStateReady();
  if (!auth.currentUser) await A.signInAnonymously(auth);
  return (fb = { app, auth, A, F, db: F.getFirestore(app) });
}
const supported = !!(cfg && cfg.apiKey && vapid && "serviceWorker" in navigator && "Notification" in window);
window.MarqueePush = {
  ready: supported,
  on: () => ls.get("marqueePushOn") === "1" && Notification.permission === "granted",
  async enable(memberId) {
    if (!("PushManager" in window)) return /iPhone|iPad/.test(navigator.userAgent) ? "On iPhone, first add Marquee to your Home Screen (Share › Add to Home Screen), then open it from there and try again." : "This browser can't show notifications.";
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return "Notifications are blocked. Allow them for this site in your browser settings.";
    try {
      const { app, auth, F, db } = await init();
      const Msg = await import(CDN + "firebase-messaging.js");
      if (!(await Msg.isSupported())) return "This browser can't receive push notifications.";
      const reg = await navigator.serviceWorker.ready;
      const token = await Msg.getToken(Msg.getMessaging(app), { vapidKey: vapid, serviceWorkerRegistration: reg });
      await F.setDoc(F.doc(db, "tokens", memberId, "devices", auth.currentUser.uid), { token, at: Date.now(), ua: navigator.userAgent.slice(0, 120) });
      ls.set("marqueePushOn", "1"); ls.set("marqueePushId", memberId);
      return true;
    } catch (e) { console.error(e); return "Couldn't turn on notifications. Try again in a minute."; }
  },
  async disable() {
    try { const { auth, F, db } = await init(); const id = ls.get("marqueePushId"); if (id) await F.deleteDoc(F.doc(db, "tokens", id, "devices", auth.currentUser.uid)); } catch (e) { console.warn(e); }
    ls.set("marqueePushOn", "0");
  },
  // { to: [member ids], title, body, at?: ms send time, id?: fixed doc id (replaces an earlier one) }
  async send(p) {
    if (!cfg || !cfg.apiKey) return;
    try {
      const { F, db } = await init();
      const data = { to: p.to.slice(0, 60), title: String(p.title).slice(0, 120), body: String(p.body || "").slice(0, 300), at: p.at || Date.now(), url: "./?view=club" };
      if (p.id) await F.setDoc(F.doc(db, "pushes", p.id), data); else await F.addDoc(F.collection(db, "pushes"), data);
    } catch (e) { console.warn("push queue", e); }
  },
};
