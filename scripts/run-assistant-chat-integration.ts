import assert from "node:assert/strict";
import { buildAssistantContext } from "../src/assistant/assistant-context";
import { assistantSystemPrompt, chatUserPrompt } from "../src/assistant/assistant-prompts";
import { formatAssistantPlainText } from "../src/assistant/plain-text";
import { FoundryRecorderRuntime } from "../src/foundry/foundry-runtime";
import { QWEN_VISION_CHAT_CANDIDATE_MODEL_ID } from "../src/foundry/optional-vision-chat-runtime";

assert.equal(
  process.platform,
  "win32",
  "The exact Foundry Local assistant chat gate must run on the target Windows machine.",
);

const runtime = new FoundryRecorderRuntime();
try {
  await runtime.prepare(false, (event) => process.stdout.write(`${event.detail}\n`));
  const context = buildAssistantContext(
    {
      liveDraft: "",
      liveSequence: -1,
      liveStreamId: null,
      finalText: "An ordinary differential equation relates a function to one or more ordinary derivatives.",
      version: 1,
      submittedVersion: null,
      summary: null,
    },
    null,
  );
  const question = "What is ODE? Answer in one sentence.";
  const result = await runtime.runAssistantTurn(
    {
      systemPrompt: assistantSystemPrompt("classroom"),
      prompt: chatUserPrompt(question, context),
    },
    {
      requestOptions: {
        search: { doSample: false, temperature: 0, seed: 42, maxOutputTokens: 100 },
        toolChoice: "none",
        additionalOptions: {
          chat_template_kwargs: JSON.stringify({ enable_thinking: false }),
        },
      },
    },
  );
  const answer = formatAssistantPlainText(result.text);
  const sentences = answer.split(/[.!?]+/u).filter((part) => part.trim().length > 0);
  assert.equal(sentences.length, 1, `Expected one sentence, received: ${answer}`);
  assert.match(answer.toLowerCase(), /(ordinary differential equation|ode)/);
  assert.equal(result.model.modelId, QWEN_VISION_CHAT_CANDIDATE_MODEL_ID);
  assert.equal(result.model.source, "shared_summary_assistant_slot");
  assert.equal(result.model.runtime.deviceType, "CPU");
  assert.equal(result.model.runtime.executionProvider, "CPUExecutionProvider");
  assert.equal(result.response.finishReason, "stop");
  console.log(
    `ASSISTANT_CHAT_INTEGRATION_OK ${JSON.stringify({
      model: result.model,
      question,
      answer,
      usage: result.response.usage,
    })}`,
  );
} finally {
  await runtime.shutdown();
}
