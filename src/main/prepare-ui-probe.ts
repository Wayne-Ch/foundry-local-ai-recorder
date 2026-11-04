import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { app, type BrowserWindow, type WebContents } from "electron";

export async function runPrepareUiProbe(
  window: BrowserWindow,
  webContents: WebContents,
  shutdown: () => Promise<void>,
): Promise<void> {
  let exitCode = 0;
  try {
    const result = (await webContents.executeJavaScript(
      `(() => {
        const prepare = document.querySelector("#prepare-button");
        const status = document.querySelector("#status-message");
        const rail = document.querySelector("#model-rail");
        if (
          !(prepare instanceof HTMLButtonElement) ||
          !(status instanceof HTMLElement) ||
          !(rail instanceof HTMLElement)
        ) {
          throw new Error("Prepare UI probe elements are unavailable.");
        }
        const observations = [];
        const capture = (label) => {
          observations.push({
            label,
            prepareText: prepare.textContent?.trim() ?? "",
            prepareBusy: prepare.getAttribute("aria-busy"),
            railBusy: rail.getAttribute("aria-busy"),
            statusText: status.textContent?.trim() ?? "",
            statusClass: status.className,
            models: ["whisper", "summary", "nemotron"].map((role) => ({
              role,
              state: document.querySelector("#" + role + "-state")?.textContent?.trim() ?? "",
              detail: document.querySelector("#" + role + "-detail")?.textContent?.trim() ?? "",
              busy: document.querySelector("#" + role + "-card")?.getAttribute("aria-busy"),
            })),
          });
        };
        capture("before-click");
        const observer = new MutationObserver(() => capture("mutation"));
        observer.observe(document.body, {
          attributes: true,
          childList: true,
          characterData: true,
          subtree: true,
        });
        prepare.click();
        capture("after-click");
        return new Promise((resolve, reject) => {
          const startedAt = performance.now();
          const timer = setInterval(() => {
            capture("poll");
            const modelStates = ["whisper", "summary", "nemotron"].map(
              (role) => document.querySelector("#" + role + "-state")?.textContent?.trim() ?? "",
            );
            const completed =
              prepare.getAttribute("aria-busy") === "false" &&
              (status.classList.contains("status-success") || status.classList.contains("status-error"));
            if (completed) {
              clearInterval(timer);
              observer.disconnect();
              resolve({
                elapsedMs: Math.round(performance.now() - startedAt),
                observations,
                finalStatus: status.textContent?.trim() ?? "",
                finalStatusClass: status.className,
                finalModelStates: modelStates,
                finalModelDetails: ["whisper", "summary", "nemotron"].map(
                  (role) => document.querySelector("#" + role + "-detail")?.textContent?.trim() ?? "",
                ),
              });
              return;
            }
            if (performance.now() - startedAt > 300000) {
              clearInterval(timer);
              observer.disconnect();
              reject(new Error("Prepare UI probe timed out."));
            }
          }, 100);
        });
      })()`,
      true,
    )) as PrepareUiProbeResult;
    const immediate = result.observations.find(({ prepareText }) => prepareText !== "Prepare local models");
    const sawBusy = result.observations.some(
      ({ prepareBusy, railBusy }) => prepareBusy === "true" && railBusy === "true",
    );
    const sawModelBusy = result.observations.some(({ models }) =>
      models.some(({ busy, state }) => busy === "true" && state !== "READY"),
    );
    if (
      immediate === undefined ||
      !sawBusy ||
      !sawModelBusy ||
      result.finalStatusClass !== "status-message status-success" ||
      !result.finalStatus.includes("Enhanced offline ready · 3/3 models") ||
      result.finalModelStates.some((state) => state !== "READY") ||
      result.finalModelDetails.some((detail) => !detail)
    ) {
      throw new Error(`Prepare UI did not reach complete visible readiness: ${JSON.stringify(result)}`);
    }
    const capturePath = process.env.SMART_RECORDER_PREPARE_UI_CAPTURE_PATH?.trim();
    if (capturePath) {
      await webContents.executeJavaScript(
        "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
        true,
      );
      const image = await webContents.capturePage();
      await mkdir(path.dirname(capturePath), { recursive: true });
      await writeFile(capturePath, image.toPNG());
    }
    const resetResult = (await webContents.executeJavaScript(
      `(() => {
        const reset = document.querySelector("#reset-button");
        if (!(reset instanceof HTMLButtonElement)) {
          throw new Error("Reset UI probe element is unavailable.");
        }
        reset.click();
        return new Promise((resolve, reject) => {
          const startedAt = performance.now();
          let sawBusy = reset.getAttribute("aria-busy") === "true";
          const timer = setInterval(() => {
            sawBusy ||= reset.getAttribute("aria-busy") === "true";
            if (sawBusy && reset.getAttribute("aria-busy") === "false") {
              clearInterval(timer);
              resolve({
                sawBusy,
                modelStates: ["whisper", "summary", "nemotron"].map(
                  (role) => document.querySelector("#" + role + "-state")?.textContent?.trim() ?? "",
                ),
              });
              return;
            }
            if (performance.now() - startedAt > 60000) {
              clearInterval(timer);
              reject(new Error("Reset UI probe timed out."));
            }
          }, 50);
        });
      })()`,
      true,
    )) as PrepareUiResetResult;
    if (!resetResult.sawBusy || resetResult.modelStates.some((state) => state !== "READY")) {
      throw new Error(`Reset did not preserve prepared model readiness: ${JSON.stringify(resetResult)}`);
    }
    console.log(
      `PREPARE_UI_PROBE_OK ${JSON.stringify({
        elapsedMs: result.elapsedMs,
        finalStatus: result.finalStatus,
        finalModelStates: result.finalModelStates,
        finalModelDetails: result.finalModelDetails,
        observedPrepareLabels: [
          ...new Set(result.observations.map(({ prepareText }) => prepareText).filter(Boolean)),
        ],
        sawBusy,
        sawModelBusy,
        resetPreservedModelStates: resetResult.modelStates,
      })}`,
    );
  } catch (error) {
    exitCode = 1;
    console.error("PREPARE_UI_PROBE_FAILED", error);
  } finally {
    try {
      await shutdown();
    } catch (error) {
      exitCode = 1;
      console.error("PREPARE_UI_PROBE_SHUTDOWN_FAILED", error);
    }
    if (!window.isDestroyed()) {
      window.destroy();
    }
    app.exit(exitCode);
  }
}

interface PrepareUiProbeResult {
  readonly elapsedMs: number;
  readonly observations: readonly {
    readonly prepareText: string;
    readonly prepareBusy: string | null;
    readonly railBusy: string | null;
    readonly statusText: string;
    readonly models: readonly {
      readonly role: string;
      readonly state: string;
      readonly detail: string;
      readonly busy: string | null;
    }[];
  }[];
  readonly finalStatus: string;
  readonly finalStatusClass: string;
  readonly finalModelStates: readonly string[];
  readonly finalModelDetails: readonly string[];
}

interface PrepareUiResetResult {
  readonly sawBusy: boolean;
  readonly modelStates: readonly string[];
}
