const { mkdir, rm, writeFile } = require("node:fs/promises");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");
const { build } = require("esbuild");

const repoRoot = path.resolve(__dirname, "..", "..");
const artifactsDirectory = path.join(repoRoot, "artifacts");
const runtimeDirectory = path.join(artifactsDirectory, "assistant-ui-probe-runtime");
const screenshotPath = path.join(artifactsDirectory, "assistant-ui-rendering.png");
const contextLabels = [
  {
    kind: "final_transcript",
    label: "final transcript v1",
    version: 1,
    ephemeral: false,
  },
];
const chatState = {
  generation: 0,
  mode: "classroom",
  image: null,
  imageAnalysis: null,
  chatMessages: [
    message("math-request", "user", "Show the decay equation."),
    message(
      "math-request",
      "assistant",
      [
        "Ordinary price: $5.00",
        "Inline: $y(t) = y_0 e^{-2t}$",
        "Display:",
        "$$x^2 + y^2 = z^2$$",
        "Unsafe: <img src=x onerror=alert(1)>",
      ].join("\n"),
    ),
    message("pending-chat", "user", "Explain why the exponent is negative."),
  ],
  activeRequestId: "pending-chat",
  activeOperation: "chat",
  pendingOperations: [
    {
      requestId: "pending-chat",
      kind: "chat",
      status: "active",
      phase: "running_inference",
    },
  ],
  queuedRequests: 0,
  maxQueuedRequests: 3,
  cleanupPending: false,
  cleanupDetail: null,
  trace: [],
};
const imageState = {
  ...chatState,
  chatMessages: [],
  activeRequestId: "pending-image",
  activeOperation: "image_analysis",
  pendingOperations: [
    {
      requestId: "pending-image",
      kind: "image_analysis",
      status: "active",
      phase: "running_inference",
    },
  ],
};

app.disableHardwareAcceleration();
if (process.getuid?.() === 0) {
  app.commandLine.appendSwitch("no-sandbox");
}

void run();

async function run() {
  await app.whenReady();
  let exitCode = 0;
  try {
    await rm(runtimeDirectory, { recursive: true, force: true });
    await mkdir(runtimeDirectory, { recursive: true });
    await buildProbeBundle();
    await writeProbeDocument();

    const window = new BrowserWindow({
      width: 900,
      height: 760,
      show: false,
      backgroundColor: "#071018",
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    await window.loadFile(path.join(runtimeDirectory, "index.html"));
    const result = await inspectRenderedUi(window);
    assertProbeResult(result);

    const screenshot = await window.webContents.capturePage();
    await writeFile(screenshotPath, screenshot.toPNG());
    window.close();
    console.log(`ASSISTANT_UI_RENDER_OK ${JSON.stringify({ ...result, screenshotPath })}`);
  } catch (error) {
    console.error("ASSISTANT_UI_RENDER_FAILED", error);
    exitCode = 1;
  } finally {
    await rm(runtimeDirectory, { recursive: true, force: true });
    app.exit(exitCode);
  }
}

async function buildProbeBundle() {
  await build({
    absWorkingDir: repoRoot,
    stdin: {
      contents: `
        import "katex/dist/katex.min.css";
        import "./src/renderer/styles.css";
        import {
          imageAnalysisMetadataValue,
          imageAnalysisProgress,
          imageAnalysisProgressMessage,
          renderAssistantChatRows,
          renderImageAnalyzeButton,
        } from "./src/renderer/assistant-progress";
        import { applyAssistantControlProgress } from "./src/renderer/assistant-control-progress";
        import { applyRecorderProgress } from "./src/renderer/recorder-progress";

        const chatRoot = document.querySelector("#chat-probe");
        const imageButton = document.querySelector("#image-analyze-probe");
        const metadataValue = document.querySelector("#image-metadata-value");
        const imageAnalysis = document.querySelector("#image-analysis-probe");
        const recorderElements = {
          prepare: document.querySelector("#recorder-prepare"),
          start: document.querySelector("#recorder-start"),
          startLabel: document.querySelector("#recorder-start-label"),
          stop: document.querySelector("#recorder-stop"),
          importButton: document.querySelector("#recorder-import"),
          saveTranscript: document.querySelector("#recorder-save"),
          summary: document.querySelector("#recorder-summary"),
          reset: document.querySelector("#recorder-reset"),
          recordingIndicator: document.querySelector("#recorder-indicator"),
          modelRail: document.querySelector("#recorder-models"),
          liveDraft: document.querySelector("#recorder-live"),
          liveCard: document.querySelector("#recorder-live-card"),
          finalTranscript: document.querySelector("#recorder-final"),
          finalCard: document.querySelector("#recorder-final-card"),
          summaryOutput: document.querySelector("#recorder-summary-output"),
          summaryCard: document.querySelector("#recorder-summary-card"),
        };
        const assistantControls = {
          mode: document.querySelector("#assistant-action-mode"),
          ask: document.querySelector("#assistant-action-ask"),
          cancel: document.querySelector("#assistant-action-cancel"),
          clear: document.querySelector("#assistant-action-clear"),
          imageSelect: document.querySelector("#assistant-action-select"),
          imageAnalyze: document.querySelector("#assistant-action-analyze"),
          imageRemove: document.querySelector("#assistant-action-remove"),
        };
        if (
          !(chatRoot instanceof HTMLElement) ||
          !(imageButton instanceof HTMLButtonElement) ||
          !(metadataValue instanceof HTMLElement) ||
          !(imageAnalysis instanceof HTMLElement) ||
          Object.values(recorderElements).some((element) => !(element instanceof HTMLElement)) ||
          Object.values(assistantControls).some((element) => !(element instanceof HTMLElement))
        ) {
          throw new Error("Missing assistant UI probe root.");
        }

        chatRoot.replaceChildren(...renderAssistantChatRows(${JSON.stringify(chatState)}));
        const progress = imageAnalysisProgress(${JSON.stringify(imageState)});
        renderImageAnalyzeButton(imageButton, progress);
        metadataValue.replaceWith(imageAnalysisMetadataValue(progress, "Unanalyzed"));
        if (progress !== null) {
          imageAnalysis.replaceChildren(imageAnalysisProgressMessage(progress));
        }
        const recorderStates = [
          { kind: "prepare", stage: "loading_model", role: "summary" },
          { kind: "recording_waiting_caption" },
          { kind: "transcribing" },
          { kind: "import", stage: "decoding_audio" },
          { kind: "summary_saving_transcript" },
          { kind: "summary_generating" },
          { kind: "resetting" },
        ];
        globalThis.__recorderProgressProbe = recorderStates.map((state) => {
          applyRecorderProgress(recorderElements, state, false);
          return {
            kind: state.kind,
            prepare: recorderElements.prepare.textContent,
            stop: recorderElements.stop.textContent,
            importButton: recorderElements.importButton.textContent,
            summary: recorderElements.summary.textContent,
            reset: recorderElements.reset.textContent,
            indicator: recorderElements.recordingIndicator.textContent,
            modelBusy: recorderElements.modelRail.getAttribute("aria-busy"),
            liveBusy: recorderElements.liveDraft.getAttribute("aria-busy"),
            finalBusy: recorderElements.finalTranscript.getAttribute("aria-busy"),
            summaryBusy: recorderElements.summaryOutput.getAttribute("aria-busy"),
          };
        });
        globalThis.__assistantControlProbe = [
          "switching_mode",
          "queuing_chat",
          "cancelling",
          "clearing",
          "selecting_image",
          "queuing_analysis",
          "removing_image",
        ].map((action) => {
          assistantControls.imageAnalyze.textContent = "Analyze image";
          assistantControls.imageAnalyze.setAttribute("aria-busy", "false");
          applyAssistantControlProgress(assistantControls, action);
          return {
            action,
            modeBusy: assistantControls.mode.getAttribute("aria-busy"),
            ask: assistantControls.ask.textContent,
            askBusy: assistantControls.ask.getAttribute("aria-busy"),
            cancel: assistantControls.cancel.textContent,
            clear: assistantControls.clear.textContent,
            select: assistantControls.imageSelect.textContent,
            analyze: assistantControls.imageAnalyze.textContent,
            analyzeBusy: assistantControls.imageAnalyze.getAttribute("aria-busy"),
            remove: assistantControls.imageRemove.textContent,
          };
        });
        globalThis.__assistantUiProbeReady = true;
      `,
      loader: "ts",
      resolveDir: repoRoot,
      sourcefile: "assistant-ui-probe.ts",
    },
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "chrome142",
    outfile: path.join(runtimeDirectory, "probe.js"),
    assetNames: "assets/[name]-[hash]",
    loader: {
      ".ttf": "file",
      ".woff": "file",
      ".woff2": "file",
    },
    logLevel: "silent",
  });
}

async function writeProbeDocument() {
  await writeFile(
    path.join(runtimeDirectory, "index.html"),
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="./probe.css" />
    <style>
      .shell {
        max-width: 860px;
        padding: 24px;
      }

      #chat-probe {
        max-height: none;
      }
    </style>
    <title>Assistant renderer probe</title>
  </head>
  <body>
    <main class="shell">
      <section>
        <h1>Assistant chat probe</h1>
        <div id="chat-probe" class="assistant-history" aria-live="polite"></div>
      </section>
      <section>
        <h2>Image analysis probe</h2>
        <button id="image-analyze-probe" class="button button-primary" type="button">
          Analyze image
        </button>
        <dl class="image-metadata">
          <dt>Analysis</dt>
          <dd id="image-metadata-value">Unanalyzed</dd>
        </dl>
        <article id="image-analysis-probe" class="image-analysis" aria-live="polite"></article>
      </section>
      <section>
        <h2>Recorder progress probe</h2>
        <div id="recorder-models"></div>
        <div id="recorder-live-card"><div id="recorder-live"></div></div>
        <div id="recorder-final-card"><textarea id="recorder-final"></textarea></div>
        <div id="recorder-summary-card"><textarea id="recorder-summary-output"></textarea></div>
        <button id="recorder-prepare"></button>
        <button id="recorder-start"><span id="recorder-start-label"></span></button>
        <button id="recorder-stop"></button>
        <button id="recorder-import"></button>
        <button id="recorder-save"></button>
        <button id="recorder-summary"></button>
        <button id="recorder-reset"></button>
        <span id="recorder-indicator"></span>
      </section>
      <section>
        <h2>Assistant control progress probe</h2>
        <select id="assistant-action-mode"><option>Classroom</option></select>
        <button id="assistant-action-ask">Ask</button>
        <button id="assistant-action-cancel">Cancel</button>
        <button id="assistant-action-clear">Clear</button>
        <button id="assistant-action-select">Choose PNG, JPEG, or WebP</button>
        <button id="assistant-action-analyze">Analyze image</button>
        <button id="assistant-action-remove">Remove</button>
      </section>
    </main>
    <script type="module" src="./probe.js"></script>
  </body>
</html>`,
    "utf8",
  );
}

async function inspectRenderedUi(window) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const ready = await window.webContents.executeJavaScript(
      "globalThis.__assistantUiProbeReady === true",
      true,
    );
    if (ready) {
      return window.webContents.executeJavaScript(
        `(() => {
          const mathMessage = document.querySelector(
            '.assistant-message-assistant[data-request-id="math-request"]',
          );
          const pendingChat = document.querySelector(".assistant-message-pending");
          const imageButton = document.querySelector("#image-analyze-probe");
          const metadata = document.querySelector(".image-metadata dd");
          const imageAnalysis = document.querySelector("#image-analysis-probe");
          if (
            !(mathMessage instanceof HTMLElement) ||
            !(pendingChat instanceof HTMLElement) ||
            !(imageButton instanceof HTMLButtonElement) ||
            !(metadata instanceof HTMLElement) ||
            !(imageAnalysis instanceof HTMLElement)
          ) {
            throw new Error("Probe assistant UI DOM is incomplete.");
          }
          return {
            inlineMath: mathMessage.querySelectorAll(".assistant-math-inline > .katex").length,
            displayMath: mathMessage.querySelectorAll(".assistant-math-display > .katex-display").length,
            unsafeElements: mathMessage.querySelectorAll("img, script, iframe, object").length,
            preservesCurrency: mathMessage.textContent?.includes("Ordinary price: $5.00") === true,
            preservesLineBreaks:
              mathMessage.textContent?.includes("Ordinary price: $5.00\\nInline:") === true,
            preservesUnsafeText:
              mathMessage.textContent?.includes("<img src=x onerror=alert(1)>") === true,
            rawMathDelimiterVisible: mathMessage.innerHTML.includes("$y(t)"),
            pendingChatText: pendingChat.textContent?.includes("Thinking locally…") === true,
            pendingChatBusy: pendingChat.getAttribute("aria-busy") === "true",
            pendingChatRequest: pendingChat.dataset.requestId === "pending-chat",
            pendingChatContext:
              pendingChat.textContent?.includes("Context: final transcript v1") === true,
            imageButtonText: imageButton.textContent?.includes("Analyzing…") === true,
            imageButtonBusy: imageButton.getAttribute("aria-busy") === "true",
            imageButtonRequest: imageButton.dataset.requestId === "pending-image",
            imageMetadataText: metadata.textContent?.includes("Analyzing") === true,
            imageMetadataStatus: metadata.getAttribute("role") === "status",
            imageDetailText: imageAnalysis.textContent?.includes("Analyzing image locally…") === true,
            imageDetailStatus:
              imageAnalysis.querySelector('[role="status"]') instanceof HTMLElement,
            progressIndicators: document.querySelectorAll(".assistant-progress-indicator").length,
            recorderProgress: globalThis.__recorderProgressProbe,
            assistantControls: globalThis.__assistantControlProbe,
          };
        })()`,
        true,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for the assistant UI renderer.");
}

function assertProbeResult(result) {
  const expected = {
    inlineMath: 1,
    displayMath: 1,
    unsafeElements: 0,
    preservesCurrency: true,
    preservesLineBreaks: true,
    preservesUnsafeText: true,
    rawMathDelimiterVisible: false,
    pendingChatText: true,
    pendingChatBusy: true,
    pendingChatRequest: true,
    pendingChatContext: true,
    imageButtonText: true,
    imageButtonBusy: true,
    imageButtonRequest: true,
    imageMetadataText: true,
    imageMetadataStatus: true,
    imageDetailText: true,
    imageDetailStatus: true,
    progressIndicators: 4,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (result[key] !== value) {
      throw new Error(
        `Unexpected ${key}: expected ${JSON.stringify(value)}, got ${JSON.stringify(result[key])}`,
      );
    }
  }
  const recorder = new Map(result.recorderProgress.map((entry) => [entry.kind, entry]));
  if (
    recorder.get("prepare")?.prepare !== "Loading summary…" ||
    recorder.get("prepare")?.modelBusy !== "true" ||
    recorder.get("recording_waiting_caption")?.liveBusy !== "true" ||
    recorder.get("transcribing")?.stop !== "Transcribing…" ||
    recorder.get("transcribing")?.finalBusy !== "true" ||
    recorder.get("import")?.importButton !== "Decoding WAV…" ||
    recorder.get("summary_saving_transcript")?.summary !== "Saving correction…" ||
    recorder.get("summary_generating")?.summary !== "Generating summary…" ||
    recorder.get("resetting")?.reset !== "Cancelling / resetting…" ||
    recorder.get("resetting")?.summaryBusy !== "true"
  ) {
    throw new Error(`Unexpected recorder progress DOM: ${JSON.stringify(result.recorderProgress)}`);
  }
  const assistantControls = new Map(result.assistantControls.map((entry) => [entry.action, entry]));
  if (
    assistantControls.get("switching_mode")?.modeBusy !== "true" ||
    assistantControls.get("queuing_chat")?.ask !== "Queuing…" ||
    assistantControls.get("queuing_chat")?.askBusy !== "true" ||
    assistantControls.get("cancelling")?.cancel !== "Cancelling…" ||
    assistantControls.get("clearing")?.clear !== "Clearing…" ||
    assistantControls.get("selecting_image")?.select !== "Opening picker…" ||
    assistantControls.get("queuing_analysis")?.analyze !== "Queuing analysis…" ||
    assistantControls.get("queuing_analysis")?.analyzeBusy !== "true" ||
    assistantControls.get("removing_image")?.remove !== "Removing…"
  ) {
    throw new Error(`Unexpected assistant control progress DOM: ${JSON.stringify(result.assistantControls)}`);
  }
}

function message(requestId, role, text) {
  return {
    id: `${requestId}-${role}`,
    requestId,
    role,
    text,
    mode: "classroom",
    contextFingerprint: "final-transcript-v1",
    dependsOnImage: false,
    imageId: null,
    imageVersion: null,
    contextLabels,
    createdAt: "2026-11-03T22:00:00.000Z",
  };
}
