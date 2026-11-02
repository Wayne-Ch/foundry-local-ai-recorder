import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildImageAnalysisContext } from "../src/assistant/assistant-context";
import { assistantSystemPrompt, imageAnalysisPrompt } from "../src/assistant/assistant-prompts";
import { validateImage } from "../src/assistant/image-security";
import { FoundryRecorderRuntime } from "../src/foundry/foundry-runtime";
import { QWEN_VISION_CHAT_CANDIDATE_MODEL_ID } from "../src/foundry/optional-vision-chat-runtime";
import { parseImageAnalysisNote } from "../src/main/assistant-controller";

assert.equal(
  process.platform,
  "win32",
  "The exact Foundry Local VLM gate must run on the target Windows machine.",
);

const filePath = path.resolve("fixtures", "ode-slide.png");
const sourceBytes = await readFile(filePath);
const image = validateImage({
  basename: path.basename(filePath),
  declaredMimeType: "image/png",
  bytes: sourceBytes,
});
const runtime = new FoundryRecorderRuntime();
try {
  await runtime.prepare(false, (event) => process.stdout.write(`${event.detail}\n`));
  const context = buildImageAnalysisContext({
    liveDraft: "",
    liveSequence: -1,
    liveStreamId: null,
    finalText:
      "The lesson defines an ordinary differential equation and solves y prime equals negative two y as exponential decay.",
    version: 1,
    submittedVersion: null,
    summary: null,
  });
  const result = await runtime.runAssistantTurn(
    {
      systemPrompt: assistantSystemPrompt("classroom"),
      prompt: imageAnalysisPrompt("classroom", context),
      images: [{ kind: "data", format: "png", data: image.bytes }],
    },
    {
      requestOptions: {
        search: { doSample: false, temperature: 0, seed: 42, maxOutputTokens: 280 },
        toolChoice: "none",
        additionalOptions: {
          chat_template_kwargs: JSON.stringify({ enable_thinking: false }),
        },
      },
    },
  );
  const note = parseImageAnalysisNote(result.text);
  assert.match(
    `${note.visibleTextAndObjects} ${note.relationToLesson}`.toLowerCase(),
    /(ordinary differential|ode|dy\/dt|derivative)/,
  );
  assert.equal(result.model.modelId, QWEN_VISION_CHAT_CANDIDATE_MODEL_ID);
  assert.equal(result.model.source, "vision_slot");
  assert.equal(result.response.finishReason, "stop");
  console.log(
    `VISION_INTEGRATION_OK ${JSON.stringify({
      model: result.model,
      note,
      usage: result.response.usage,
      fixture: {
        basename: image.basename,
        width: image.width,
        height: image.height,
        sizeBytes: image.sizeBytes,
      },
    })}`,
  );
} finally {
  sourceBytes.fill(0);
  image.bytes.fill(0);
  await runtime.shutdown();
}
