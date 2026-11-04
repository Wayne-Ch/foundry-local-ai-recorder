import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import electronPath from "electron";

const capturePath = path.resolve("artifacts", "ai-recorder-populated-summary.png");
await mkdir(path.dirname(capturePath), { recursive: true });
const child = spawn(electronPath, ["."], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    AI_RECORDER_CAPTURE_PATH: capturePath,
    AI_RECORDER_CAPTURE_AND_EXIT: "1",
    AI_RECORDER_CAPTURE_FIXTURE: "populated-summary",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
child.stdout.on("data", (chunk) => {
  output += chunk.toString();
});
child.stderr.on("data", (chunk) => {
  output += chunk.toString();
});
const timeout = setTimeout(() => child.kill(), 25_000);
const [code] = await once(child, "exit");
clearTimeout(timeout);
if (code !== 0) {
  throw new Error(`UI capture failed (${code}):\n${output}`);
}
console.log(`UI_CAPTURE_OK ${capturePath}`);
