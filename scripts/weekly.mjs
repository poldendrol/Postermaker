// Weekly Marquee alerts (GitHub Actions, .github/workflows/weekly.yml):
//  • "Now on your services": a title on your Personal watchlist became available on one of your streaming services (Belgium).
//  • New seasons: a series you've been watching gets a new season within the next week.
// Reads the club history from Firestore (clubs/{club}/ev), services from svc/{member}, remembers what it already told in weekly/{member},
// and queues pushes in pushes/{id} for scripts/push.mjs to deliver.
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!raw) { console.log("No FIREBASE_SERVICE_ACCOUNT secret yet, nothing to do."); process.exit(0); }
initializeApp({ credential: cert(JSON.parse(raw)) });
const db = getFirestore(), now = Date.now(), today = new Date().toISOString().slice(0, 10);
const TMDB = "74291c551ed59c6c86af38b7d24a65cc"; // the app's public TMDB key
const cache = new Map();
async function tm(path) {
  if (cache.has(path)) return cache.get(path);
  let j = null; try { const r = await fetch(`https://api.themoviedb.org/3${path}${path.includes("?") ? "&" : "?"}api_key=${TMDB}`); if (r.ok) j = await r.json(); } catch {}
  cache.set(path, j); return j;
}
const key = m => m ? m.t + ":" + m.i : "";
const seenKey = t => "t:" + String(t || "").toLowerCase().replace(/\s*\(\d{4}\)\s*$/, "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const addDays = (d, n) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

// Every member across all clubs: their watchlist and the series they're watching.
const people = new Map(); // id -> { wl: Map(key -> m), tv: Map(key -> { m, ss }) }
const person = id => { if (!people.has(id)) people.set(id, { wl: new Map(), tv: new Map() }); return people.get(id); };
for (const club of await db.collection("clubs").listDocuments()) {
  const E = (await club.collection("ev").get()).docs.map(d => d.data()).filter(e => e && !e.gone && e.a && !String(e.a).startsWith("demo_")).sort((a, b) => a.t - b.t);
  const wl = new Map(), saw = new Map(); // wl: a -> Map(key -> {m, at}); saw: a -> Map(sk -> event)
  for (const e of E) {
    if (e.k === "wl" && e.m) { (wl.get(e.a) || wl.set(e.a, new Map()).get(e.a)).set(key(e.m), { m: e.m, at: e.t }); }
    else if (e.k === "wldrop" && e.m) wl.get(e.a)?.delete(key(e.m));
    else if (e.k === "saw" && e.sk) { const mp = saw.get(e.a) || saw.set(e.a, new Map()).get(e.a), p = mp.get(e.sk); mp.set(e.sk, { ...e, m: e.m || p?.m }); }
  }
  for (const [a, mp] of wl) for (const [k, w] of mp) { const x = saw.get(a)?.get(seenKey(w.m.n)); if (x?.v && (!x.m || key(x.m) === k) && x.t >= w.at) continue; person(a).wl.set(k, w.m); }
  for (const [a, mp] of saw) for (const x of mp.values()) if (x.v && x.m?.t === "tv" && x.ss && Object.keys(x.ss).length) person(a).tv.set(key(x.m), { m: x.m, ss: x.ss });
}

let queued = 0;
for (const [id, p] of people) {
  const hasDevice = !(await db.collection("tokens").doc(id).collection("devices").limit(1).get()).empty;
  if (!hasDevice) continue; // nobody to tell
  const stRef = db.collection("weekly").doc(id), st0 = (await stRef.get()).data(), st = { avail: st0?.avail || {}, seasons: st0?.seasons || {} }, first = !st0;
  const svc = new Set((await db.collection("svc").doc(id).get()).data()?.ids || []);
  // 1. Now on your services
  if (svc.size) {
    const fresh = [];
    for (const [k, m] of [...p.wl].slice(0, 250)) {
      const j = await tm(`/${m.t}/${m.i}/watch/providers`), be = j?.results?.BE || {};
      const on = [...(be.flatrate || []), ...(be.free || []), ...(be.ads || [])].filter(x => svc.has(x.provider_id));
      const ids = [...new Set(on.map(x => x.provider_id))], prev = st.avail[k];
      if (!first && prev && ids.some(i => !prev.includes(i))) fresh.push(`${m.n} (${on.find(x => !prev.includes(x.provider_id)).provider_name})`);
      st.avail[k] = ids;
    }
    if (fresh.length) {
      await db.collection("pushes").doc(`avail_${id}_${today}`.replace(/[^\w]/g, "")).set({ to: [id], at: now, url: "./?view=club", title: fresh.length === 1 ? "Now on your services" : `${fresh.length} titles from your list are now streaming`, body: fresh.slice(0, 3).join(", ") + (fresh.length > 3 ? ` and ${fresh.length - 3} more` : "") });
      queued++;
    }
  }
  // 2. New seasons of series you watch
  for (const [k, { m, ss }] of p.tv) {
    const j = await tm(`/tv/${m.i}`), nx = j?.next_episode_to_air;
    if (!nx || nx.episode_number !== 1 || !nx.air_date || nx.air_date < today || nx.air_date > addDays(today, 8)) continue;
    if (st.seasons[k] === nx.season_number) continue;
    st.seasons[k] = nx.season_number;
    const when = new Date(nx.air_date + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
    await db.collection("pushes").doc(`season_${id}_${m.i}_${nx.season_number}`.replace(/[^\w]/g, "").slice(0, 60)).set({ to: [id], at: now, url: "./?view=club", title: `${m.n}: season ${nx.season_number} is coming`, body: `It starts ${when}.` });
    queued++;
  }
  await stRef.set({ ...st, at: now });
}
console.log(`${people.size} members checked, ${queued} alerts queued.`);
