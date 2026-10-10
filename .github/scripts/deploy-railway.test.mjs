import { test } from "node:test";
import assert from "node:assert/strict";
import { deployRailway } from "./deploy-railway.mjs";
const env = { RAILWAY_TOKEN: "synthetic", RAILWAY_PROJECT_ID: "project", RAILWAY_SERVICE_ID: "service", RAILWAY_ENVIRONMENT_ID: "environment", RAILWAY_PUBLIC_URL: "https://synthetic.example", GITHUB_SHA: "checked-commit" };
const noWait = async () => {};
test("missing configuration and invalid origins prevent any upload", async () => {
  for (const name of Object.keys(env).filter(n => n.startsWith("RAILWAY_")))
    await assert.rejects(deployRailway({ ...env, [name]: "" }, () => assert.fail("must not upload")), /Missing/);
  await assert.rejects(deployRailway({ ...env, RAILWAY_PUBLIC_URL: "http://synthetic.example" }, () => assert.fail("must not upload")), /HTTPS/);
});
test("an older successful deployment cannot mask a new migration or startup failure", async () => {
  const run = args => args[0] === "up" ? '{"deploymentId":"new"}' : JSON.stringify([{ id: "old", status: "SUCCESS" }, { id: "new", status: "FAILED" }]);
  await assert.rejects(deployRailway(env, run, noWait), /new ended with FAILED/);
});
test("waits through deployment startup and targets the exact project, service and environment", async () => {
  let polls = 0;
  const run = args => {
    assert.deepEqual(args.slice(args[0] === "up" ? 1 : 2, args[0] === "up" ? 7 : 8), ["--project", "project", "--service", "service", "--environment", "environment"]);
    if (args[0] === "up") { assert.ok(args.includes("--detach")); assert.ok(args.includes("GitHub checked-commit")); return '{"deploymentId":"new"}\n'; }
    return JSON.stringify([{ id: "new", status: ++polls === 1 ? "DEPLOYING" : "SUCCESS" }]);
  };
  assert.equal(await deployRailway(env, run, noWait), "new"); assert.equal(polls, 2);
});
test("missing upload IDs and missing terminal statuses fail closed", async () => {
  await assert.rejects(deployRailway(env, () => '{}', noWait), /deployment ID/);
  await assert.rejects(deployRailway(env, args => args[0] === "up" ? '{"deploymentId":"new"}' : '[]', noWait, 2), /Timed out/);
});
