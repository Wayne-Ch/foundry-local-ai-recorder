import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const installer = path.resolve("node_modules", "foundry-local-sdk", "script", "install-native.cjs");
if (!existsSync(installer)) {
  throw new Error("foundry-local-sdk is not installed. Run npm ci and retry.");
}

const result = spawnSync(process.execPath, [installer], {
  cwd: process.cwd(),
  env: process.env,
  encoding: "utf8",
  stdio: "inherit",
});
if (result.error) {
  throw result.error;
}
if (result.status !== 0) {
  throw new Error(`Foundry Local native runtime installation failed with exit code ${result.status}.`);
}
