import electronPath from "electron";
import { runOwnedProcess } from "./electron-process-tree.mjs";

const { code, output } = await runOwnedProcess({
  command: electronPath,
  args: ["."],
  cwd: process.cwd(),
  env: {
    ...process.env,
    AI_RECORDER_MIC_PERMISSION_PROBE: "1",
  },
  label: "Microphone permission probe",
  timeoutMs: 25_000,
});
if (code !== 0 || !output.includes("MICROPHONE_PERMISSION_PROBE_OK")) {
  throw new Error(`Microphone probe failed (${code}):\n${output}`);
}
console.log(output.trim());
