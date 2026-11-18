// Optional: sends phone notifications even when Marquee is closed.
// Needs the Firebase Blaze plan (pay as you go; this stays within the free monthly allowance for a group of friends).
// Deploy once from a computer: npm i -g firebase-tools && firebase login && firebase deploy --only functions
const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");
admin.initializeApp();

const APP_URL = "https://poldendrol.github.io/Postermaker/?view=friends";

async function push(uid, title, body) {
  const ref = admin.firestore().doc(`users/${uid}/private/push`);
  const snap = await ref.get();
  const tokens = (snap.exists && snap.get("tokens")) || [];
  if (!tokens.length) return;
  const res = await admin.messaging().sendEachForMulticast({
    tokens,
    data: { title, body, url: APP_URL },
    webpush: { headers: { Urgency: "high" } }
  });
  const dead = tokens.filter((t, i) => !res.responses[i].success);
  if (dead.length) await ref.update({ tokens: admin.firestore.FieldValue.arrayRemove(...dead) });
}

exports.onSuggested = onDocumentCreated({ document: "suggestions/{id}", region: "europe-west1" }, async e => {
  const s = e.data.data();
  await push(s.to, `${s.fromName} suggests ${s.title}`, s.note || "Open Marquee to see it.");
});

exports.onWatched = onDocumentUpdated({ document: "suggestions/{id}", region: "europe-west1" }, async e => {
  const b = e.data.before.data(), a = e.data.after.data();
  if (b.status === "watched" || a.status !== "watched") return;
  const extra = [a.score ? "★".repeat(a.score) : "", a.comment ? `“${a.comment}”` : ""].filter(Boolean).join(" ");
  await push(a.from, `${a.toName} watched ${a.title}`, extra || "Tap to see what they thought.");
});
