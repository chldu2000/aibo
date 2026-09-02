import { spawn } from "node:child_process";
import process from "node:process";

const smoke = process.argv.includes("--smoke");
const scripts = ["probes/codex-app-server.mjs", "probes/run-pi.mjs"];

function run(script) {
  return new Promise((resolve) => {
    const args = [script];
    if (smoke) args.push("--smoke");
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
      windowsHide: true,
    });
    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}

const results = [];
for (const script of scripts) {
  results.push(await run(script));
}

if (results.some((code) => code !== 0)) {
  process.exitCode = 1;
}
