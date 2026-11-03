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
  pendingOperations: [{ requestId: "pending-chat", kind: "chat", status: "active" }],
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
  pendingOperations: [{ requestId: "pending-image", kind: "image_analysis", status: "active" }],
};

app.disableHardwareAcceleration();
if (process.getuid?.() === 0) {
  app.commandLine.appendSwitch("no-sandbox");
}

void run();

async function run() {
  await app.whenReady();
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
    process.exitCode = 1;
  } finally {
    await rm(runtimeDirectory, { recursive: true, force: true });
    app.quit();
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

        const chatRoot = document.querySelector("#chat-probe");
        const imageButton = document.querySelector("#image-analyze-probe");
        const metadataValue = document.querySelector("#image-metadata-value");
        const imageAnalysis = document.querySelector("#image-analysis-probe");
        if (
          !(chatRoot instanceof HTMLElement) ||
          !(imageButton instanceof HTMLButtonElement) ||
          !(metadataValue instanceof HTMLElement) ||
          !(imageAnalysis instanceof HTMLElement)
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
