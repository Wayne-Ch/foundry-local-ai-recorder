import electronPath from "electron";
import { runOwnedProcess } from "./electron-process-tree.mjs";

const { code, output } = await runOwnedProcess({
  command: electronPath,
  args: ["."],
  cwd: process.cwd(),
  env: { ...process.env, AI_RECORDER_SMOKE_AND_EXIT: "1" },
  label: "Electron smoke probe",
  timeoutMs: 20_000,
});
if (code !== 0) {
  throw new Error(`Electron smoke failed (${code}):\n${output}`);
}
console.log("ELECTRON_SMOKE_OK");
