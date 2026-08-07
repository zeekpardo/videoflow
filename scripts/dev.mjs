import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const localEnv = existsSync(".env.local") ? readFileSync(".env.local", "utf8") : "";
const testMode = /^NEXT_PUBLIC_TEST_MODE=true$/m.test(localEnv) || process.env.NEXT_PUBLIC_TEST_MODE === "true";
const demoMode = /^NEXT_PUBLIC_DEMO_MODE=true$/m.test(localEnv) || process.env.NEXT_PUBLIC_DEMO_MODE === "true";
const forwarded = process.argv.slice(2);

if (testMode || demoMode) {
  console.log(`Starting VideoFlow in ${demoMode ? "sales demo" : "local test"} mode (Next.js only).\n`);
  const result = spawnSync("npm", ["run", "dev:next", ...(forwarded.length ? ["--", ...forwarded] : [])], { stdio: "inherit" });
  process.exitCode = result.status ?? 1;
} else {
  console.log("Starting VideoFlow in connected mode (Next.js + Convex).\n");
  const result = spawnSync("npx", ["npm-run-all", "--parallel", "dev:next", "dev:convex"], { stdio: "inherit" });
  process.exitCode = result.status ?? 1;
}
