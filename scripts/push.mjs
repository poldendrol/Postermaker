// Sends queued Marquee push notifications. Runs every 5 minutes in GitHub Actions (.github/workflows/push.yml).
// Needs the FIREBASE_SERVICE_ACCOUNT secret (the JSON key from Firebase → Project settings → Service accounts).
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";

const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!raw) { console.log("No FIREBASE_SERVICE_ACCOUNT secret yet, nothing to do."); process.exit(0); }
initializeApp({ credential: cert(JSON.parse(raw)) });
const db = getFirestore(), fcm = getMessaging(), now = Date.now();

const due = await db.collection("pushes").where("at", "<=", now).limit(300).get();
let sent = 0, dropped = 0;
const tokensFor = new Map();
async function tokens(id) {
  if (!tokensFor.has(id)) tokensFor.set(id, (await db.collection("tokens").doc(id).collection("devices").get()).docs.map(d => ({ ref: d.ref, token: d.get("token") })).filter(x => x.token));
  return tokensFor.get(id);
}
for (const doc of due.docs) {
  const p = doc.data();
  if (now - p.at > 2 * 864e5) { await doc.ref.delete(); continue; } // too old to be useful
  const list = (await Promise.all((p.to || []).slice(0, 60).map(id => tokens(String(id))))).flat();
  if (list.length) {
    const res = await fcm.sendEachForMulticast({ tokens: list.map(x => x.token), data: { title: String(p.title || "Marquee"), body: String(p.body || ""), url: String(p.url || "./?view=club") }, webpush: { headers: { Urgency: "high", TTL: "86400" } } });
    res.responses.forEach((r, i) => { if (r.success) sent++; else if (/not-registered|invalid-registration|invalid-argument/.test(r.error?.code || "")) { list[i].ref.delete().catch(() => {}); dropped++; } });
  }
  await doc.ref.delete();
}
console.log(`${due.size} queued, ${sent} delivered, ${dropped} dead tokens removed.`);
