import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { setTimeout } from "node:timers/promises";

export async function deployRailway(env = process.env, run = args => execFileSync("railway", args, { encoding: "utf8", timeout: 180000, maxBuffer: 8 * 1024 * 1024 }), pause = () => setTimeout(5000), attempts = 240) {
  for (const name of ["RAILWAY_TOKEN", "RAILWAY_PROJECT_ID", "RAILWAY_SERVICE_ID", "RAILWAY_ENVIRONMENT_ID", "RAILWAY_PUBLIC_URL"])
    if (!env[name]?.trim()) throw new Error(`Missing deployment configuration: ${name}`);
  const origin = new URL(env.RAILWAY_PUBLIC_URL);
  if (origin.protocol !== "https:" || origin.origin !== env.RAILWAY_PUBLIC_URL)
    throw new Error("RAILWAY_PUBLIC_URL must be an exact HTTPS origin without a trailing slash");
  const target = ["--project", env.RAILWAY_PROJECT_ID, "--service", env.RAILWAY_SERVICE_ID, "--environment", env.RAILWAY_ENVIRONMENT_ID];
  // CI=true and --ci wait for the build only. Capture and poll the exact upload instead.
  const output = run(["up", ...target, "--detach", "--json", "--message", `GitHub ${env.GITHUB_SHA ?? "release"}`]);
  const objects = output.trim().split("\n").flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  const id = objects.findLast(o => typeof o.deploymentId === "string")?.deploymentId;
  if (!id) throw new Error("Railway upload did not return a deployment ID");
  console.log(`Waiting for Railway deployment ${id}`);
  for (let attempt = 0; attempt < attempts; attempt++) {
    const deployments = JSON.parse(run(["deployment", "list", ...target, "--limit", "100", "--json"]));
    if (!Array.isArray(deployments)) throw new Error("Unexpected Railway deployment status response");
    const deployment = deployments.find(d => d.id === id);
    if (deployment?.status === "SUCCESS") {
      console.log(`Railway deployment ${id} reached SUCCESS`);
      return id;
    }
    if (["FAILED", "CRASHED", "REMOVED", "SKIPPED", "CANCELLED", "CANCELED"].includes(deployment?.status))
      throw new Error(`Railway deployment ${id} ended with ${deployment.status}`);
    await pause();
  }
  throw new Error(`Timed out waiting for Railway deployment ${id}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await deployRailway();
