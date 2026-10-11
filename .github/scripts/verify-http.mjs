import assert from "node:assert/strict";
import { setTimeout } from "node:timers/promises";
import { pathToFileURL } from "node:url";

export async function verifyHttp(origin, { attempts = 24, pause = () => setTimeout(5000), request = fetch } = {}) {
  if (!origin || new URL(origin).origin !== origin) throw new Error("Supply the exact application origin");
  let ready = false;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await request(origin + "/api/health/ready", { signal: AbortSignal.timeout(10000) });
      ready = response.ok && (await response.json()).status === "ready";
    } catch { /* Wait for startup, never accept the SPA as readiness. */ }
    if (ready) break;
    await pause();
  }
  assert.ok(ready, "Application readiness check failed");
  const home = await request(origin + "/", { signal: AbortSignal.timeout(10000) });
  assert.equal(home.status, 200); assert.match(home.headers.get("content-type"), /text\/html/);
  const html = await home.text(); assert.match(html, /CampusOne/); assert.match(html, /id="root"/);
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"?]+\.(?:js|css))"/g)].map(m => m[1]);
  assert.ok(assets.some(a => a.endsWith(".js")), "Missing built frontend script");
  for (const asset of assets) {
    const response = await request(origin + asset, { signal: AbortSignal.timeout(10000) });
    assert.equal(response.status, 200); assert.match(response.headers.get("content-type"), asset.endsWith(".js") ? /javascript/ : /text\/css/);
    assert.doesNotMatch((await response.text()).slice(0, 200), /<!doctype html/i);
  }
  const unknown = await request(origin + "/api/nonexistent-release-check", { signal: AbortSignal.timeout(10000) });
  assert.equal(unknown.status, 404); assert.match(unknown.headers.get("content-type"), /application\/json/);
  console.log(`Readiness, home, ${assets.length} built frontend assets and API routing verified`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await verifyHttp(process.argv[2] ?? process.env.APP_ORIGIN);
