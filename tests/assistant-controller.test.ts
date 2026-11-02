import type { RequestOptions } from "foundry-local-sdk";
import { DeviceType } from "foundry-local-sdk";
import { describe, expect, it, vi } from "vitest";
import type { ValidatedImage } from "../src/assistant/image-security";
import type { AssistantRuntimeStatus } from "../src/foundry/foundry-runtime";
import type { VisionChatTurnInput, VisionChatTurnResult } from "../src/foundry/optional-vision-chat-runtime";
import type { AssistantRuntime } from "../src/main/assistant-controller";
import { AssistantController, parseImageAnalysisNote } from "../src/main/assistant-controller";
import type { TranscriptSnapshot } from "../src/transcript/transcript-store";

describe("AssistantController", () => {
  it("answers from an ephemeral live snapshot without persisting the live text", async () => {
    let transcript = snapshot({ liveDraft: "private live ODE words", liveSequence: 4 });
    const runtime = new FakeRuntime("An ODE relates a function to its ordinary derivatives.");
    const controller = new AssistantController({
      getTranscript: () => transcript,
      runtime,
    });
    const updates: string[] = [];

    controller.startChat("session-1", "What is ODE? Answer in one sentence.", (state) => {
      updates.push(JSON.stringify(state));
    });
    await vi.waitFor(() =>
      expect(controller.snapshot().chatMessages.some((message) => message.role === "assistant")).toBe(true),
    );

    expect(runtime.inputs[0]?.prompt).toContain("private live ODE words");
    expect(JSON.stringify(controller.snapshot())).not.toContain("private live ODE words");
    expect(controller.snapshot().chatMessages[0]?.contextLabels[0]?.label).toBe(
      "live draft snapshot (may change)",
    );
    transcript = snapshot({ finalText: "final", version: 1 });
    expect(updates.length).toBeGreaterThan(1);
  });

  it("applies clinic safety to every request", async () => {
    const runtime = new FakeRuntime("Educational explanation only.");
    const controller = new AssistantController({
      getTranscript: () => snapshot({}),
      runtime,
    });
    controller.setMode("clinic");

    controller.startChat("session-1", "Explain the term.", () => {});
    await vi.waitFor(() => expect(runtime.inputs).toHaveLength(1));

    expect(runtime.inputs[0]?.systemPrompt).toContain("must not diagnose");
    expect(runtime.inputs[0]?.systemPrompt).toContain("qualified interpreter");
  });

  it("rejects stale image analysis when the transcript version changes", async () => {
    let transcript = snapshot({ finalText: "version one", version: 1 });
    let release = () => {};
    const runtime = new FakeRuntime(
      "Visible text/objects: y' = -2y\nRelation to lesson: It is an ODE.\nUncertainty: None visible.",
      async () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const controller = new AssistantController({
      getTranscript: () => transcript,
      runtime,
    });
    controller.selectImage(image(), "data:image/png;base64,abc");

    controller.startImageAnalysis("session-1", () => {});
    await vi.waitFor(() => expect(runtime.inputs).toHaveLength(1));
    transcript = snapshot({ finalText: "corrected", version: 2 });
    release();
    await vi.waitFor(() =>
      expect(controller.snapshot().trace.some((entry) => entry.phase === "image-analysis-stale")).toBe(true),
    );

    expect(controller.snapshot().imageAnalysis).toBeNull();
  });

  it("uses direct VLM image data for image-specific chat and works without images otherwise", async () => {
    const runtime = new FakeRuntime("The diagram shows exponential decay.");
    const controller = new AssistantController({
      getTranscript: () => snapshot({}),
      runtime,
    });

    controller.startChat("session-1", "Give one practical example.", () => {});
    await vi.waitFor(() => expect(runtime.inputs).toHaveLength(1));
    expect(runtime.inputs[0]?.images).toBeUndefined();
    expect(() => controller.startChat("session-1", "Explain the selected image.", () => {})).toThrow(
      "Select an image",
    );

    controller.selectImage(image(), "data:image/png;base64,abc");
    controller.startChat("session-1", "Explain the selected image in one sentence.", () => {});
    await vi.waitFor(() => expect(runtime.inputs).toHaveLength(2));
    expect(runtime.inputs[1]?.images?.[0]).toMatchObject({ kind: "data", format: "png" });
  });

  it("owns an image copy after the caller releases its validated buffer", async () => {
    const runtime = new FakeRuntime(
      "Visible text/objects: ODE\nRelation to lesson: Equation\nUncertainty: None",
    );
    const controller = new AssistantController({
      getTranscript: () => snapshot({}),
      runtime,
    });
    const validated = image();
    controller.selectImage(validated, "data:image/png;base64,abc");
    validated.bytes.fill(0);

    controller.startImageAnalysis("session-1", () => {});
    await vi.waitFor(() => expect(runtime.imagePayloads).toHaveLength(1));

    expect(runtime.imagePayloads[0]).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("reset clears visible optional state immediately while native cleanup drains", async () => {
    let release = () => {};
    const runtime = new FakeRuntime(
      "answer",
      async () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const controller = new AssistantController({
      getTranscript: () => snapshot({ finalText: "core final", version: 1 }),
      runtime,
    });
    controller.selectImage(image(), "data:image/png;base64,abc");
    controller.startChat("session-1", "What is ODE?", () => {});
    await vi.waitFor(() => expect(runtime.inputs).toHaveLength(1));

    const reset = controller.reset();

    expect(reset).toMatchObject({
      image: null,
      imageAnalysis: null,
      chatMessages: [],
      mode: "classroom",
      activeRequestId: null,
      activeOperation: null,
      cleanupPending: true,
    });
    expect(runtime.resetAssistant).toHaveBeenCalledOnce();
    expect(() => controller.startChat("session-1", "Another question", () => {})).toThrow(
      "cleanup is still draining",
    );
    release();
  });

  it("parses only the required structured image note", () => {
    expect(
      parseImageAnalysisNote(
        "Visible text/objects: ODE slope field\nRelation to lesson: Shows solution curves\nUncertainty: Labels are small",
      ),
    ).toEqual({
      visibleTextAndObjects: "ODE slope field",
      relationToLesson: "Shows solution curves",
      uncertainty: "Labels are small",
    });
    expect(() => parseImageAnalysisNote("A loose paragraph.")).toThrow("structured note");
  });
});

class FakeRuntime implements AssistantRuntime {
  assistantStatus: AssistantRuntimeStatus = {
    active: false,
    draining: false,
    visionModelId: null,
  };
  readonly inputs: VisionChatTurnInput[] = [];
  readonly imagePayloads: Uint8Array[] = [];
  readonly cancelAssistantOperations = vi.fn((_reason?: unknown): Promise<void> | null => {
    if (!this.assistantStatus.active) {
      return null;
    }
    this.assistantStatus = {
      ...this.assistantStatus,
      active: false,
      draining: true,
    };
    return Promise.resolve();
  });
  readonly resetAssistant = vi.fn(
    (): Promise<void> => this.cancelAssistantOperations(new Error("Reset")) ?? Promise.resolve(),
  );

  constructor(
    readonly answer: string,
    readonly beforeAnswer: () => Promise<void> = async () => {},
  ) {}

  async runAssistantTurn(
    input: VisionChatTurnInput,
    _options?: { readonly signal?: AbortSignal; readonly requestOptions?: RequestOptions },
  ): Promise<VisionChatTurnResult> {
    this.assistantStatus = {
      ...this.assistantStatus,
      active: true,
      draining: false,
    };
    this.inputs.push(input);
    for (const image of input.images ?? []) {
      if (image.kind === "data") {
        this.imagePayloads.push(image.data.slice());
      }
    }
    try {
      await this.beforeAnswer();
      return {
        text: this.answer,
        model: {
          modelId: input.images === undefined ? "summary-model" : "vision-model",
          source: input.images === undefined ? "summary_slot" : "vision_slot",
          task: input.images === undefined ? "chat-completion" : "vision-language-chat",
          runtime: {
            deviceType: DeviceType.CPU,
            executionProvider: "CPUExecutionProvider",
          },
          inputModalities: input.images === undefined ? ["text"] : ["text", "image"],
          outputModalities: ["text"],
        },
        preflight: {
          promptTokens: 1,
          outputReserveTokens: 1,
          requiredTokens: 2,
          contextLimitTokens: 4096,
          fits: true,
          deficitTokens: 0,
        },
        response: {
          output: [{ type: "text", text: this.answer }],
          finishReason: "stop",
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        },
      };
    } finally {
      this.assistantStatus = {
        ...this.assistantStatus,
        active: false,
        draining: false,
      };
    }
  }
}

function snapshot(overrides: Partial<TranscriptSnapshot>): TranscriptSnapshot {
  return {
    liveDraft: "",
    liveSequence: -1,
    liveStreamId: null,
    finalText: "",
    version: 0,
    submittedVersion: null,
    summary: null,
    ...overrides,
  };
}

function image(): ValidatedImage {
  return {
    basename: "ode.png",
    mimeType: "image/png",
    sizeBytes: 3,
    width: 10,
    height: 10,
    bytes: new Uint8Array([1, 2, 3]),
  };
}
