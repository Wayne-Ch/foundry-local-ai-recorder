import { mkdir } from "node:fs/promises";
import path from "node:path";
import electronPath from "electron";
import { runOwnedProcess } from "./electron-process-tree.mjs";

const capturePath = path.resolve("artifacts", "ai-recorder-populated-summary.png");
await mkdir(path.dirname(capturePath), { recursive: true });
const { code, output } = await runOwnedProcess({
  command: electronPath,
  args: ["."],
  cwd: process.cwd(),
  env: {
    ...process.env,
    AI_RECORDER_CAPTURE_PATH: capturePath,
    AI_RECORDER_CAPTURE_AND_EXIT: "1",
    AI_RECORDER_CAPTURE_FIXTURE: "populated-summary",
  },
  label: "UI capture probe",
  timeoutMs: 25_000,
});
if (code !== 0) {
  throw new Error(`UI capture failed (${code}):\n${output}`);
}
console.log(`UI_CAPTURE_OK ${capturePath}`);
