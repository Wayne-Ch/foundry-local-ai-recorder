import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import electronPath from "electron";

const artifacts = path.resolve("artifacts");
const userData = path.join(artifacts, "prepare-ui-profile");
const appData = path.join(artifacts, "prepare-ui-app-data");
const capturePath = path.join(artifacts, "prepare-models-ui.png");
await Promise.all([
  rm(userData, { recursive: true, force: true }),
  rm(appData, { recursive: true, force: true }),
]);
await Promise.all([mkdir(userData, { recursive: true }), mkdir(appData, { recursive: true })]);

const args = [`--user-data-dir=${userData}`, "."];
if (process.getuid?.() === 0) {
  args.unshift("--no-sandbox");
}
const child = spawn(electronPath, args, {
  cwd: process.cwd(),
  env: {
    ...process.env,
    SMART_RECORDER_APP_DATA_DIR: appData,
    SMART_RECORDER_PREPARE_UI_PROBE: "1",
    SMART_RECORDER_PREPARE_UI_CAPTURE_PATH: capturePath,
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
const timeout = setTimeout(() => child.kill(), 360_000);
const [code] = await once(child, "exit");
clearTimeout(timeout);
if (code !== 0 || !output.includes("PREPARE_UI_PROBE_OK")) {
  throw new Error(`Prepare UI probe failed (${code}):\n${output}`);
}
const resultLine = output.split(/\r?\n/u).find((line) => line.startsWith("PREPARE_UI_PROBE_OK "));
console.log(resultLine);
console.log(`PREPARE_UI_CAPTURE_OK ${capturePath}`);
