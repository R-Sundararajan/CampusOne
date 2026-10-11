import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { api, sessionExpiredEvent } from "../src/services/api.ts";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; delete globalThis.window; });

test("protected 401 ends the UI session while preserving the useful API error", async () => {
  const events = new EventTarget();
  Object.defineProperty(globalThis, "window", { value: events, configurable: true });
  let expired = 0;
  events.addEventListener(sessionExpiredEvent, () => expired++);
  globalThis.fetch = async () => new Response(JSON.stringify({ error: "Login expired or invalid" }), { status: 401 });
  await assert.rejects(api("/admin/role-requests"), /Login expired or invalid/);
  assert.equal(expired, 1);
});

test("invalid credentials, initial anonymous state and permission failures do not end a session", async () => {
  const events = new EventTarget();
  Object.defineProperty(globalThis, "window", { value: events, configurable: true });
  let expired = 0;
  events.addEventListener(sessionExpiredEvent, () => expired++);
  for (const [path, status] of [["/auth/login", 401], ["/auth/me", 401], ["/admin/role-requests", 403], ["/events", 500]] as const) {
    globalThis.fetch = async () => new Response(JSON.stringify({ error: "Request denied" }), { status });
    await assert.rejects(api(path), /Request denied/);
  }
  assert.equal(expired, 0);
});
