import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import electronPath from "electron";
import { runOwnedProcess } from "./electron-process-tree.mjs";

const artifacts = path.resolve("artifacts");
const userData = path.join(artifacts, "ai-recorder-prepare-ui-profile");
const appData = path.join(artifacts, "ai-recorder-prepare-ui-app-data");
const capturePath = path.join(artifacts, "ai-recorder-prepare-models-ui.png");
await Promise.all([
  rm(userData, { recursive: true, force: true }),
  rm(appData, { recursive: true, force: true }),
]);
await Promise.all([mkdir(userData, { recursive: true }), mkdir(appData, { recursive: true })]);

const args = [`--user-data-dir=${userData}`, "."];
if (process.getuid?.() === 0) {
  args.unshift("--no-sandbox");
}
const { code, output } = await runOwnedProcess({
  command: electronPath,
  args,
  cwd: process.cwd(),
  env: {
    ...process.env,
    AI_RECORDER_APP_DATA_DIR: appData,
    AI_RECORDER_PREPARE_UI_PROBE: "1",
    AI_RECORDER_PREPARE_UI_CAPTURE_PATH: capturePath,
  },
  label: "Prepare UI probe",
  timeoutMs: 360_000,
});
if (code !== 0 || !output.includes("PREPARE_UI_PROBE_OK")) {
  throw new Error(`Prepare UI probe failed (${code}):\n${output}`);
}
const resultLine = output.split(/\r?\n/u).find((line) => line.startsWith("PREPARE_UI_PROBE_OK "));
console.log(resultLine);
console.log(`PREPARE_UI_CAPTURE_OK ${capturePath}`);
