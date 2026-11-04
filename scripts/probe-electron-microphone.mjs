import { spawn } from "node:child_process";
import { once } from "node:events";
import electronPath from "electron";

const electronArgs = process.getuid?.() === 0 ? ["--no-sandbox", "."] : ["."];
const child = spawn(electronPath, electronArgs, {
  cwd: process.cwd(),
  env: {
    ...process.env,
    ENHANCED_AI_RECORDER_MIC_PERMISSION_PROBE: "1",
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
