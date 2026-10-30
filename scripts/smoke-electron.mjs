import { spawn } from "node:child_process";
import { once } from "node:events";
import electronPath from "electron";

const child = spawn(electronPath, ["."], {
  cwd: process.cwd(),
  env: { ...process.env, SMART_RECORDER_SMOKE_AND_EXIT: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});
const output = [];
child.stdout.on("data", (chunk) => output.push(chunk.toString()));
child.stderr.on("data", (chunk) => output.push(chunk.toString()));
const timeout = setTimeout(() => child.kill(), 20_000);
const [code] = await once(child, "exit");
clearTimeout(timeout);
if (code !== 0) {
  throw new Error(`Electron smoke failed (${code}):\n${output.join("")}`);
}
console.log("ELECTRON_SMOKE_OK");
