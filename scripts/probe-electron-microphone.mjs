import { spawn } from "node:child_process";
import { once } from "node:events";
import electronPath from "electron";

const child = spawn(electronPath, ["."], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    AI_RECORDER_MIC_PERMISSION_PROBE: "1",
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
if (code !== 0 || !output.includes("MICROPHONE_PERMISSION_PROBE_OK")) {
  throw new Error(`Microphone probe failed (${code}):\n${output}`);
}
console.log(output.trim());
