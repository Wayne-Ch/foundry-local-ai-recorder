import type { RequestOptions } from "foundry-local-sdk";
import { DeviceType } from "foundry-local-sdk";
import { describe, expect, it, vi } from "vitest";
import type {
  AssistantImageByteLifecycle,
  AssistantImageBytePurpose,
} from "../src/assistant/image-byte-lifecycle";
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
      expect(
        controller
          .snapshot()
          .trace.some(
            (entry) => entry.phase === "image-analysis-stale" || entry.phase === "assistant-context-stale",
          ),
      ).toBe(true),
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

  it("invalidates an open image picker token immediately on Reset or mode change", () => {
    const runtime = new FakeRuntime("answer");
    const controller = new AssistantController({
      getTranscript: () => snapshot({}),
      runtime,
    });
    const resetToken = controller.captureImagePickerToken("session-1");

    controller.reset();
    expect(() => controller.assertImagePickerToken(resetToken)).toThrow("stale assistant state");

    const modeToken = controller.captureImagePickerToken("session-1");
    controller.setMode("clinic");
    expect(() => controller.assertImagePickerToken(modeToken)).toThrow("stale assistant state");
  });

  it.each(["replace", "remove", "reset"] as const)(
    "%s cancels a queued image chat before any operation byte copy exists",
    async (action) => {
      let release = () => {};
      const lifecycle = new TrackingImageByteLifecycle();
      const runtime = new FakeRuntime(
        ["Text answer.", "Visible text/objects: ODE\nRelation to lesson: Equation\nUncertainty: None"],
        async (_input, index) => {
          if (index === 0) {
            await new Promise<void>((resolve) => {
              release = resolve;
            });
          }
        },
      );
      const controller = new AssistantController({
        getTranscript: () => snapshot({ finalText: "lesson", version: 1 }),
        runtime,
        imageByteLifecycle: lifecycle,
      });
      controller.selectImage(image(), "data:image/png;base64,abc");
      controller.startChat("session-1", "What is ODE?", () => {});
      await vi.waitFor(() => expect(runtime.inputs).toHaveLength(1));
      controller.startChat("session-1", "Explain the selected image.", () => {});
      expect(controller.snapshot().queuedRequests).toBe(1);
      expect(lifecycle.copies("assistant-operation")).toHaveLength(0);

      if (action === "replace") {
        controller.selectImage(image([9, 8, 7]), "data:image/png;base64,replacement");
      } else if (action === "remove") {
        controller.removeImage();
      } else {
        controller.reset();
      }

      release();
      await vi.waitFor(() => expect(controller.snapshot().queuedRequests).toBe(0));
      expect(lifecycle.copies("assistant-operation")).toHaveLength(0);
      expect(runtime.inputs).toHaveLength(1);
    },
  );

  it.each(["replace", "remove"] as const)(
    "%s cancels active image chat and releases its execution copy",
    async (action) => {
      let release = () => {};
      const lifecycle = new TrackingImageByteLifecycle();
      const runtime = new FakeRuntime(
        "stale image answer",
        async () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      );
      const controller = new AssistantController({
        getTranscript: () => snapshot({ finalText: "lesson", version: 1 }),
        runtime,
        imageByteLifecycle: lifecycle,
      });
      controller.selectImage(image(), "data:image/png;base64,abc");
      controller.startChat("session-1", "Explain the selected image.", () => {});
      await vi.waitFor(() => expect(runtime.inputs).toHaveLength(1));
      const operationBytes = lifecycle.copies("assistant-operation")[0];

      if (action === "replace") {
        controller.selectImage(image([9, 8, 7]), "data:image/png;base64,replacement");
      } else {
        controller.removeImage();
      }
      expect(controller.snapshot().activeRequestId).toBeNull();
      expect(controller.snapshot().cleanupPending).toBe(true);

      release();
      await vi.waitFor(() => expect(controller.snapshot().cleanupPending).toBe(false));
      expect(operationBytes).toEqual(new Uint8Array([0, 0, 0]));
      expect(controller.snapshot().chatMessages.some((message) => message.role === "assistant")).toBe(false);
    },
  );

  it("copies current image bytes only at execution and releases the operation copy", async () => {
    let release = () => {};
    const lifecycle = new TrackingImageByteLifecycle();
    const runtime = new FakeRuntime(
      "Visible text/objects: ODE\nRelation to lesson: Equation\nUncertainty: None",
      async () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const controller = new AssistantController({
      getTranscript: () => snapshot({ finalText: "lesson", version: 1 }),
      runtime,
      imageByteLifecycle: lifecycle,
    });
    controller.selectImage(image(), "data:image/png;base64,abc");
    controller.startImageAnalysis("session-1", () => {});
    await vi.waitFor(() => expect(runtime.inputs).toHaveLength(1));

    const operationCopy = lifecycle.copies("assistant-operation")[0];
    expect(operationCopy).toEqual(new Uint8Array([1, 2, 3]));
    expect(lifecycle.isLive(operationCopy as Uint8Array)).toBe(true);

    release();
    await vi.waitFor(() => expect(controller.snapshot().imageAnalysis).not.toBeNull());
    expect(operationCopy).toEqual(new Uint8Array([0, 0, 0]));
    expect(lifecycle.isLive(operationCopy as Uint8Array)).toBe(false);
  });

  it("invalidates transcript-v1 analysis before corrected-v2 chat while reanalysis waits", async () => {
    let transcript = snapshot({ finalText: "version one", version: 1 });
    let releaseV2Chat = () => {};
    const runtime = new FakeRuntime(
      [
        "Visible text/objects: OLD V1 NOTE\nRelation to lesson: Old lesson\nUncertainty: None",
        "Version two answer.",
        "Visible text/objects: NEW V2 NOTE\nRelation to lesson: Corrected lesson\nUncertainty: None",
      ],
      async (_input, index) => {
        if (index === 1) {
          await new Promise<void>((resolve) => {
            releaseV2Chat = resolve;
          });
        }
      },
    );
    const controller = new AssistantController({
      getTranscript: () => transcript,
      runtime,
    });
    controller.selectImage(image(), "data:image/png;base64,abc");
    controller.startImageAnalysis("session-1", () => {});
    await vi.waitFor(() => expect(controller.snapshot().imageAnalysis).not.toBeNull());

    transcript = snapshot({ finalText: "corrected version two", version: 2 });
    controller.startChat("session-1", "Explain the correction.", () => {});
    await vi.waitFor(() => expect(runtime.inputs).toHaveLength(2));
    controller.startImageAnalysis("session-1", () => {});

    expect(controller.snapshot().imageAnalysis).toBeNull();
    expect(controller.snapshot().image?.analysisStatus).toBe("unanalyzed");
    expect(controller.snapshot().queuedRequests).toBe(1);
    expect(runtime.inputs[1]?.prompt).toContain("corrected version two");
    expect(runtime.inputs[1]?.prompt).not.toContain("OLD V1 NOTE");

    releaseV2Chat();
    await vi.waitFor(() => expect(runtime.inputs).toHaveLength(3));
    await vi.waitFor(() =>
      expect(controller.snapshot().imageAnalysis?.visibleTextAndObjects).toBe("NEW V2 NOTE"),
    );
  });

  it("clears unsafe classroom output on Clinic switch and requires image reanalysis", async () => {
    const runtime = new FakeRuntime([
      "Visible text/objects: UNSAFE CLASSROOM NOTE\nRelation to lesson: Classroom only\nUncertainty: None",
      "UNSAFE CLASSROOM ANSWER",
      "Clinic-safe educational answer.",
    ]);
    const controller = new AssistantController({
      getTranscript: () => snapshot({ finalText: "shared lesson", version: 1 }),
      runtime,
    });
    controller.selectImage(image(), "data:image/png;base64,abc");
    controller.startImageAnalysis("session-1", () => {});
    await vi.waitFor(() => expect(controller.snapshot().imageAnalysis).not.toBeNull());
    controller.startChat("session-1", "Explain the lesson.", () => {});
    await vi.waitFor(() =>
      expect(controller.snapshot().chatMessages.some((message) => message.role === "assistant")).toBe(true),
    );

    const clinic = controller.setMode("clinic");

    expect(clinic).toMatchObject({
      mode: "clinic",
      image: { analysisStatus: "unanalyzed" },
      imageAnalysis: null,
      chatMessages: [],
    });
    expect(JSON.stringify(clinic.trace)).not.toContain("UNSAFE CLASSROOM");
    expect(clinic.trace.at(-1)?.phase).toBe("mode-isolation");

    controller.startChat("session-1", "Explain the term.", () => {});
    await vi.waitFor(() => expect(runtime.inputs).toHaveLength(3));
    expect(runtime.inputs[2]?.systemPrompt).toContain("must not diagnose");
    expect(runtime.inputs[2]?.prompt).not.toContain("UNSAFE CLASSROOM");
  });

  it("parses inline structured image notes", () => {
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

  it("parses the exact CPU VLM section-and-bullets response", () => {
    expect(parseImageAnalysisNote(EXACT_CPU_VLM_RESULT)).toEqual({
      visibleTextAndObjects: [
        "Equation: dy/dt = -2y",
        "Solution: y(t) = y0 * e^(-2t)",
        "Graph: y vs t curve showing exponential decay",
      ].join("\n"),
      relationToLesson: "Demonstrates the solution to the first order decay model",
      uncertainty: "No uncertainty",
    });
  });

  it("handles case-insensitive headings, numbering, wrapped lines, and extra whitespace", () => {
    expect(
      parseImageAnalysisNote(`
        VISIBLE TEXT / OBJECTS :
        1. Equation: dy/dt = -2y
           with initial value y(0) = y0
        * Graph: exponential decay

        relation TO lesson:
        1) Connects the equation to
           the plotted solution

        UNCERTAINTY : Labels are small
      `),
    ).toEqual({
      visibleTextAndObjects: "Equation: dy/dt = -2y with initial value y(0) = y0\nGraph: exponential decay",
      relationToLesson: "Connects the equation to the plotted solution",
      uncertainty: "Labels are small",
    });
  });

  it("preserves inert markup and math text while stripping only leading list markers", () => {
    expect(
      parseImageAnalysisNote(
        "Visible text/objects:\n- <b>ODE</b>: y = -2y * t\nRelation to lesson:\n• Uses -2 as the decay rate\nUncertainty:\n- None",
      ),
    ).toEqual({
      visibleTextAndObjects: "<b>ODE</b>: y = -2y * t",
      relationToLesson: "Uses -2 as the decay rate",
      uncertainty: "None",
    });
  });

  it("allows identical duplicate sections but rejects conflicting duplicates", () => {
    expect(
      parseImageAnalysisNote(
        "Visible text/objects: ODE\nVisible text/objects: ODE\nRelation to lesson: Lesson\nUncertainty: None",
      ).visibleTextAndObjects,
    ).toBe("ODE");
    expect(() =>
      parseImageAnalysisNote(
        "Visible text/objects: ODE\nVisible text/objects: Different\nRelation to lesson: Lesson\nUncertainty: None",
      ),
    ).toThrow("duplicated with conflicting content");
  });

  it.each([
    [
      "reordered",
      "Relation to lesson: Lesson\nVisible text/objects: ODE\nUncertainty: None",
      "sections must appear",
    ],
    ["missing", "Visible text/objects: ODE\nRelation to lesson: Lesson", "sections must appear"],
    ["empty", "Visible text/objects:\nRelation to lesson: Lesson\nUncertainty: None", "is empty"],
    ["unstructured", "This is an ODE slide with a graph.", "unexpected text"],
  ])("rejects %s image notes", (_label, raw, expected) => {
    expect(() => parseImageAnalysisNote(raw)).toThrow(expected);
  });

  it("enforces per-field and combined output bounds", () => {
    expect(() =>
      parseImageAnalysisNote(
        `Visible text/objects: ${"x".repeat(1_501)}\nRelation to lesson: Lesson\nUncertainty: None`,
      ),
    ).toThrow("field bound");
    expect(() =>
      parseImageAnalysisNote(
        `Visible text/objects: ${"v".repeat(1_100)}\nRelation to lesson: ${"r".repeat(
          1_100,
        )}\nUncertainty: ${"u".repeat(1_100)}`,
      ),
    ).toThrow("total bound");
  });
});

const EXACT_CPU_VLM_RESULT = `Visible text/objects:
- Equation: dy/dt = -2y
- Solution: y(t) = y0 * e^(-2t)
- Graph: y vs t curve showing exponential decay
Relation to lesson:
- Demonstrates the solution to the first order decay model
Uncertainty:
- No uncertainty`;

class FakeRuntime implements AssistantRuntime {
  assistantStatus: AssistantRuntimeStatus = {
    active: false,
    draining: false,
    visionModelId: null,
    cleanupDiagnostic: null,
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
    readonly answer: string | readonly string[],
    readonly beforeAnswer: (input: VisionChatTurnInput, index: number) => Promise<void> = async () => {},
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
    const index = this.inputs.length;
    this.inputs.push(input);
    for (const image of input.images ?? []) {
      if (image.kind === "data") {
        this.imagePayloads.push(image.data.slice());
      }
    }
    try {
      await this.beforeAnswer(input, index);
      const answer = Array.isArray(this.answer)
        ? (this.answer[index] ?? this.answer.at(-1) ?? "")
        : this.answer;
      return {
        text: answer,
        model: {
          modelId: "qwen3.5-0.8b-generic-cpu:3",
          source: "vision_slot",
          task: "vision-language-chat",
          runtime: {
            deviceType: DeviceType.CPU,
            executionProvider: "CPUExecutionProvider",
          },
          inputModalities: ["text", "image"],
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
          output: [{ type: "text", text: answer }],
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

function image(bytes: readonly number[] = [1, 2, 3]): ValidatedImage {
  return {
    basename: "ode.png",
    mimeType: "image/png",
    sizeBytes: 3,
    width: 10,
    height: 10,
    bytes: new Uint8Array(bytes),
  };
}

class TrackingImageByteLifecycle implements AssistantImageByteLifecycle {
  readonly #copies = new Map<AssistantImageBytePurpose, Uint8Array[]>();
  readonly #live = new Set<Uint8Array>();

  copy(source: Uint8Array, purpose: AssistantImageBytePurpose): Uint8Array {
    const bytes = source.slice();
    const copies = this.#copies.get(purpose) ?? [];
    copies.push(bytes);
    this.#copies.set(purpose, copies);
    this.#live.add(bytes);
    return bytes;
  }

  release(bytes: Uint8Array): void {
    bytes.fill(0);
    this.#live.delete(bytes);
  }

  copies(purpose: AssistantImageBytePurpose): readonly Uint8Array[] {
    return this.#copies.get(purpose) ?? [];
  }

  isLive(bytes: Uint8Array): boolean {
    return this.#live.has(bytes);
  }
}
