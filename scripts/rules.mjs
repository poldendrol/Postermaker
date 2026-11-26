// Publishes firestore.rules to the Firebase project. Runs in GitHub Actions (.github/workflows/rules.yml) when the rules change.
import { readFileSync } from "node:fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getSecurityRules } from "firebase-admin/security-rules";

const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!raw) { console.log("No FIREBASE_SERVICE_ACCOUNT secret yet, nothing to do."); process.exit(0); }
initializeApp({ credential: cert(JSON.parse(raw)) });
const src = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
const rs = await getSecurityRules().releaseFirestoreRulesetFromSource(src);
console.log("Published Firestore rules:", rs.name);
