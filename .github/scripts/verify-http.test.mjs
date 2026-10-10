import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyHttp } from "./verify-http.mjs";

const origin = "https://synthetic.example";
const options = { attempts: 2, pause: async () => {} };
const html = '<html>CampusOne<div id="root"></div><script src="/assets/app.js"></script><link href="/assets/app.css"></html>';
const response = (body, type, status = 200) => new Response(body, { status, headers: { "content-type": type } });
function request(url) {
  const path = new URL(url).pathname;
  if (path === "/api/health/ready") return response('{"status":"ready"}', "application/json");
  if (path === "/") return response(html, "text/html");
  if (path.endsWith(".js")) return response('console.log("frontend")', "application/javascript");
  if (path.endsWith(".css")) return response("body{}", "text/css");
  return response('{"error":"not found"}', "application/json", 404);
}

test("requires an exact origin before making requests", async () => {
  for (const value of [undefined, origin + "/", origin + "/path"])
    await assert.rejects(verifyHttp(value, { ...options, request: () => assert.fail("must not request") }), /exact application origin/);
});
test("retries readiness and verifies built assets and API boundaries", async () => {
  let probes = 0;
  await verifyHttp(origin, { ...options, request: url => url.endsWith("/ready") && ++probes === 1
    ? response('{"status":"unavailable"}', "application/json", 503) : request(url) });
  assert.equal(probes, 2);
});
test("a healthy SPA cannot mask an unavailable database", async () => {
  await assert.rejects(verifyHttp(origin, { ...options, request: () => response(html, "text/html") }), /readiness check failed/);
});
test("rejects missing frontend content and SPA fallbacks at assets or API routes", async () => {
  for (const badPath of ["/", "/assets/app.js", "/api/nonexistent-release-check"])
    await assert.rejects(verifyHttp(origin, { ...options, request: url => new URL(url).pathname === badPath
      ? response("<!doctype html><html></html>", "text/html") : request(url) }));
});
