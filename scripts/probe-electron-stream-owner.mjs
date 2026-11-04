import electronPath from "electron";
import { runOwnedProcess } from "./electron-process-tree.mjs";

const { code, output } = await runOwnedProcess({
  command: electronPath,
  args: ["."],
  cwd: process.cwd(),
  env: {
    ...process.env,
    AI_RECORDER_STREAM_OWNER_PROBE: "1",
  },
  label: "Stream-owner probe",
  timeoutMs: 25_000,
});
if (code !== 0 || !output.includes("STREAM_OWNER_PROBE_OK")) {
  throw new Error(`Stream-owner probe failed (${code}):\n${output}`);
}
console.log(output.trim());
