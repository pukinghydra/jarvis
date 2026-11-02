// One random token for the THRIFTIN <-> Jarvis feed. Run on your own
// computer: node scripts/gen-secret.mjs
// Paste it as THRIFTIN_FEED_TOKEN (Jarvis project) and JARVIS_FEED_TOKEN
// (THRIFTIN project). Never paste it into a chat.
// (Jarvis's other secrets are made inside its database: app_secrets.)
import { randomBytes } from "node:crypto";
console.log(randomBytes(32).toString("base64url"));
