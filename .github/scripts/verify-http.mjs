import assert from "node:assert/strict";
import { setTimeout } from "node:timers/promises";
const origin = process.argv[2] ?? process.env.RAILWAY_PUBLIC_URL;
if (!origin || new URL(origin).origin !== origin) throw new Error("Supply the exact application origin");
let ready = false;
for (let attempt = 0; attempt < 24; attempt++) {
  try {
    const response = await fetch(origin + "/api/health/ready", { signal: AbortSignal.timeout(10000) });
    ready = response.ok && (await response.json()).status === "ready";
  } catch { /* Wait for startup, never accept the SPA as readiness. */ }
  if (ready) break;
  await setTimeout(5000);
}
assert.ok(ready, "Application readiness check failed");
const home = await fetch(origin + "/", { signal: AbortSignal.timeout(10000) });
assert.equal(home.status, 200); assert.match(home.headers.get("content-type"), /text\/html/);
const html = await home.text(); assert.match(html, /CampusOne/); assert.match(html, /id="root"/);
const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"?]+\.(?:js|css))"/g)].map(m => m[1]);
assert.ok(assets.some(a => a.endsWith(".js")), "Missing built frontend script");
for (const asset of assets) {
  const response = await fetch(origin + asset, { signal: AbortSignal.timeout(10000) });
  assert.equal(response.status, 200); assert.match(response.headers.get("content-type"), asset.endsWith(".js") ? /javascript/ : /text\/css/);
  assert.doesNotMatch((await response.text()).slice(0, 200), /<!doctype html/i);
}
const unknown = await fetch(origin + "/api/nonexistent-release-check");
assert.equal(unknown.status, 404); assert.match(unknown.headers.get("content-type"), /application\/json/);
console.log(`Readiness, home, ${assets.length} built frontend assets and API routing verified`);
