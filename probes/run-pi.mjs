import { spawn } from "node:child_process";
import process from "node:process";

const smoke = process.argv.includes("--smoke");

function run(script, args = []) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
      windowsHide: true,
    });
    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}

const sdkResult = await run("probes/pi-sdk.mjs", smoke ? ["--smoke"] : []);
const rpcResult = await run(
  "probes/pi-rpc.mjs",
  smoke ? ["--smoke"] : [],
);

if (sdkResult !== 0 || rpcResult !== 0) {
  process.exitCode = 1;
}
