#!/usr/bin/env node
/**
 * Smoke check against local or production health endpoint.
 * Usage: node scripts/smoke-health.mjs [baseUrl]
 */
const base = process.argv[2] || process.env.APP_URL || "http://localhost:3000";
const url = `${base.replace(/\/$/, "")}/api/health`;

const res = await fetch(url);
const data = await res.json();
console.log(JSON.stringify(data, null, 2));

const ok =
  res.ok &&
  data.status === "ok" &&
  data.geminiConfigured === true &&
  data.serverOnline === true;

if (!ok) {
  console.error("SMOKE FAIL");
  process.exit(1);
}

if (data.environment === "production" && data.storageConfigured && data.storageOk === false) {
  console.error("SMOKE WARN: production storage probe failed — Save/Redo may break.");
  process.exit(2);
}

console.log("SMOKE OK");
