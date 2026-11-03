import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { RequestOptions } from "foundry-local-sdk";
import { DeviceType } from "foundry-local-sdk";
import { describe, expect, it, vi } from "vitest";
import { assistantSystemPrompt } from "../src/assistant/assistant-prompts";
import type {
  AssistantImageByteLifecycle,
  AssistantImageBytePurpose,
} from "../src/assistant/image-byte-lifecycle";
import type { ValidatedImage } from "../src/assistant/image-security";
import type { AssistantRuntimeStatus } from "../src/foundry/foundry-runtime";
import type { VisionChatTurnInput, VisionChatTurnResult } from "../src/foundry/optional-vision-chat-runtime";
import type { AssistantRuntime } from "../src/main/assistant-controller";
import { AssistantController, parseImageAnalysisNote } from "../src/main/assistant-controller";
import { pickAssistantImage } from "../src/main/assistant-image-picker";
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

  it("accepts a queued chat with its original live snapshot after multiple partial updates", async () => {
    let transcript = snapshot({ liveDraft: "blocking live snapshot", liveSequence: 1 });
    let releaseFirst = () => {};
    const runtime = new FakeRuntime(["blocking answer", "queued snapshot answer"], async (_input, index) => {
      if (index === 0) {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
      }
    });
    const controller = new AssistantController({
      getTranscript: () => transcript,
      runtime,
    });

    controller.startChat("session-1", "Block the queue.", () => {});
    await vi.waitFor(() => expect(runtime.inputs).toHaveLength(1));

    transcript = snapshot({ liveDraft: "queued ask-time snapshot", liveSequence: 2 });
    controller.synchronizeTranscriptContext();
    const queued = controller.startChat("session-1", "Use the queued snapshot.", () => {});
    expect(controller.snapshot().queuedRequests).toBe(1);

    transcript = snapshot({ liveDraft: "later partial three", liveSequence: 3 });
    controller.synchronizeTranscriptContext();
    transcript = snapshot({ liveDraft: "later partial four", liveSequence: 4 });
    controller.synchronizeTranscriptContext();

    releaseFirst();
    await vi.waitFor(() => expect(runtime.inputs).toHaveLength(2));
    await vi.waitFor(() =>
      expect(
        controller
          .snapshot()
          .chatMessages.some(
            (message) => message.requestId === queued.requestId && message.role === "assistant",
          ),
      ).toBe(true),
    );

    expect(runtime.inputs[1]?.prompt).toContain("queued ask-time snapshot");
    expect(runtime.inputs[1]?.prompt).not.toContain("later partial three");
    expect(runtime.inputs[1]?.prompt).not.toContain("later partial four");
    expect(
      controller
        .snapshot()
        .chatMessages.filter((message) => message.requestId === queued.requestId)
        .map((message) => message.contextLabels.map((label) => label.label)),
    ).toEqual([["live draft snapshot (may change)"], ["live draft snapshot (may change)"]]);
  });

  it("keeps a running live-snapshot answer when final transcript arrives and uses final context next", async () => {
    let transcript = snapshot({ liveDraft: "original live ask-time text", liveSequence: 10 });
    let releaseLiveAnswer = () => {};
    const runtime = new FakeRuntime(
      ["answer from captured live text", "answer from final text"],
      async (_input, index) => {
        if (index === 0) {
          await new Promise<void>((resolve) => {
            releaseLiveAnswer = resolve;
          });
        }
      },
    );
    const controller = new AssistantController({
      getTranscript: () => transcript,
      runtime,
    });

    const liveRequest = controller.startChat("session-1", "Unique live question?", () => {});
    await vi.waitFor(() => expect(runtime.inputs).toHaveLength(1));

    transcript = snapshot({ liveDraft: "second live partial", liveSequence: 11 });
    controller.synchronizeTranscriptContext();
    transcript = snapshot({ liveDraft: "third live partial", liveSequence: 12 });
    controller.synchronizeTranscriptContext();
    transcript = snapshot({ finalText: "authoritative final transcript", version: 7 });
    controller.synchronizeTranscriptContext();

    releaseLiveAnswer();
    await vi.waitFor(() =>
      expect(
        controller
          .snapshot()
          .chatMessages.some(
            (message) => message.requestId === liveRequest.requestId && message.role === "assistant",
          ),
      ).toBe(true),
    );

    expect(runtime.inputs[0]?.prompt).toContain("original live ask-time text");
    expect(runtime.inputs[0]?.prompt).not.toContain("authoritative final transcript");
    expect(
      controller
        .snapshot()
        .chatMessages.filter((message) => message.requestId === liveRequest.requestId)
        .map((message) => message.contextLabels.map((label) => label.label)),
    ).toEqual([["live draft snapshot (may change)"], ["live draft snapshot (may change)"]]);

    const finalRequest = controller.startChat("session-1", "Unique final question?", () => {});
    await vi.waitFor(() => expect(runtime.inputs).toHaveLength(2));
    await vi.waitFor(() =>
      expect(
        controller
          .snapshot()
          .chatMessages.some(
            (message) => message.requestId === finalRequest.requestId && message.role === "assistant",
          ),
      ).toBe(true),
    );

    expect(runtime.inputs[1]?.prompt).toContain("authoritative final transcript");
    expect(runtime.inputs[1]?.prompt).not.toContain("original live ask-time text");
    expect(runtime.inputs[1]?.prompt).not.toContain("Unique live question?");
    expect(runtime.inputs[1]?.prompt).not.toContain("answer from captured live text");
    expect(
      controller
        .snapshot()
        .chatMessages.filter((message) => message.requestId === finalRequest.requestId)
        .map((message) => message.contextLabels.map((label) => label.label)),
    ).toEqual([["final transcript v7"], ["final transcript v7"]]);
    expect(controller.snapshot().chatMessages).toHaveLength(4);
  });

  it("keeps captured image-analysis chat across transcript updates but invalidates the stored analysis", async () => {
    let transcript = snapshot({ liveDraft: "image-grounded live snapshot", liveSequence: 20 });
    let releaseChat = () => {};
    const runtime = new FakeRuntime(
      [
        "Visible text/objects: CAPTURED ODE DIAGRAM\nRelation to lesson: Captured relation\nUncertainty: None",
        "The captured diagram supports the lesson.",
      ],
      async (_input, index) => {
        if (index === 1) {
          await new Promise<void>((resolve) => {
            releaseChat = resolve;
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

    const chat = controller.startChat(
      "session-1",
      "How does the lesson example support the explanation?",
      () => {},
    );
    await vi.waitFor(() => expect(runtime.inputs).toHaveLength(2));
    transcript = snapshot({ liveDraft: "newer image-grounded partial", liveSequence: 21 });
    controller.synchronizeTranscriptContext();

    expect(controller.snapshot().imageAnalysis).toBeNull();
    expect(controller.snapshot().cleanupPending).toBe(false);
    releaseChat();
    await vi.waitFor(() =>
      expect(
        controller
          .snapshot()
          .chatMessages.some(
            (message) => message.requestId === chat.requestId && message.role === "assistant",
          ),
      ).toBe(true),
    );

    expect(runtime.inputs[1]?.prompt).toContain("image-grounded live snapshot");
    expect(runtime.inputs[1]?.prompt).toContain("CAPTURED ODE DIAGRAM");
    expect(
      controller
        .snapshot()
        .chatMessages.filter((message) => message.requestId === chat.requestId)
        .map((message) => message.contextLabels.map((label) => label.label)),
    ).toEqual([
      ["live draft snapshot (may change)", "image analysis v1"],
      ["live draft snapshot (may change)", "image analysis v1"],
    ]);
  });

  it("keeps image-independent chat when the selected image is replaced", async () => {
    let release = () => {};
    const runtime = new FakeRuntime(
      "Image-independent answer.",
      async () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const controller = new AssistantController({
      getTranscript: () => snapshot({ finalText: "lesson", version: 1 }),
      runtime,
    });
    controller.selectImage(image(), "data:image/png;base64,abc");
    const chat = controller.startChat("session-1", "What is an ordinary differential equation?", () => {});
    await vi.waitFor(() => expect(runtime.inputs).toHaveLength(1));

    controller.selectImage(image([9, 8, 7]), "data:image/png;base64,replacement");
    expect(controller.snapshot().cleanupPending).toBe(false);
    release();
    await vi.waitFor(() =>
      expect(
        controller
          .snapshot()
          .chatMessages.some(
            (message) => message.requestId === chat.requestId && message.role === "assistant",
          ),
      ).toBe(true),
    );

    expect(
      controller
        .snapshot()
        .chatMessages.filter((message) => message.requestId === chat.requestId)
        .every((message) => !message.dependsOnImage),
    ).toBe(true);
  });

  it.each(["reset", "clear", "mode", "revoke"] as const)(
    "%s still discards an active chat answer",
    async (action) => {
      let release = () => {};
      const runtime = new FakeRuntime(
        "stale answer",
        async () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      );
      const controller = new AssistantController({
        getTranscript: () => snapshot({ liveDraft: "captured live text", liveSequence: 1 }),
        runtime,
      });
      const request = controller.startChat("session-1", "Explain the lesson.", () => {});
      await vi.waitFor(() => expect(runtime.inputs).toHaveLength(1));

      switch (action) {
        case "reset":
          controller.reset();
          break;
        case "clear":
          controller.clearChat();
          break;
        case "mode":
          controller.setMode("clinic");
          break;
        case "revoke":
          controller.revokeSession("session-1");
          break;
      }

      release();
      await vi.waitFor(() => expect(controller.snapshot().cleanupPending).toBe(false));
      expect(
        controller
          .snapshot()
          .chatMessages.some(
            (message) => message.requestId === request.requestId && message.role === "assistant",
          ),
      ).toBe(false);
    },
  );

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

  it("rejects in-flight image analysis after a tail-only transcript correction", async () => {
    const initialTranscript =
      "An ordinary differential equation relates a function to its derivatives. For the first order equation y prime equals negative two y, separate the variables. The solution is y of t equals c times e to the negative two t for decay over time. If y of 0 equals 3, then c equals 3.";
    let transcript = snapshot({ finalText: initialTranscript, version: 1 });
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
    transcript = snapshot({
      finalText: initialTranscript.replace(
        "If y of 0 equals 3, then c equals 3.",
        "If y of 0 equals 4, then c equals 4.",
      ),
      version: 1,
    });
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

  it("invalidates a tail-only transcript correction even when the bounded image topic is unchanged", async () => {
    const initialTranscript =
      "An ordinary differential equation relates a function to its derivatives. For the first order equation y prime equals negative two y, separate the variables. The solution is y of t equals c times e to the negative two t for decay over time. If y of 0 equals 3, then c equals 3.";
    const correctedTranscript = initialTranscript.replace(
      "If y of 0 equals 3, then c equals 3.",
      "If y of 0 equals 4, then c equals 4.",
    );
    let transcript = snapshot({ finalText: initialTranscript, version: 7 });
    const runtime = new FakeRuntime([
      "Visible text/objects: ODE graph\nRelation to lesson: Exponential decay\nUncertainty: None",
      "Visible text/objects: ODE graph\nRelation to lesson: Exponential decay\nUncertainty: None",
    ]);
    const controller = new AssistantController({
      getTranscript: () => transcript,
      runtime,
    });
    controller.selectImage(image(), "data:image/png;base64,abc");

    controller.startImageAnalysis("session-1", () => {});
    await vi.waitFor(() => expect(controller.snapshot().imageAnalysis).not.toBeNull());
    const originalFingerprint = controller.snapshot().imageAnalysis?.contextFingerprint;
    const originalPrompt = runtime.inputs[0]?.prompt;

    transcript = snapshot({ finalText: correctedTranscript, version: 7 });
    expect(controller.synchronizeTranscriptContext().changed).toBe(true);
    expect(controller.snapshot().imageAnalysis).toBeNull();

    controller.startImageAnalysis("session-1", () => {});
    await vi.waitFor(() => expect(runtime.inputs).toHaveLength(2));
    await vi.waitFor(() => expect(controller.snapshot().imageAnalysis).not.toBeNull());

    expect(runtime.inputs[1]?.prompt).toBe(originalPrompt);
    expect(controller.snapshot().imageAnalysis?.contextFingerprint).not.toBe(originalFingerprint);
  });

  it("uses system-only safety and supported bounded image request options", async () => {
    const runtime = new FakeRuntime(
      "Visible text/objects: ODE graph\nRelation to lesson: Exponential decay\nUncertainty: None",
    );
    const controller = new AssistantController({
      getTranscript: () =>
        snapshot({
          finalText:
            "An ordinary differential equation relates a function to its derivatives. For the first order equation y prime equals negative two y, separate the variables. The solution is y of t equals c times e to the negative two t for decay over time. If y of 0 equals 3, then c equals 3.",
          version: 1,
        }),
      runtime,
    });
    controller.selectImage(image(), "data:image/png;base64,abc");

    controller.startImageAnalysis("session-1", () => {});
    await vi.waitFor(() => expect(runtime.inputs).toHaveLength(1));

    expect(runtime.inputs[0]?.systemPrompt).toBe(assistantSystemPrompt("classroom"));
    expect(runtime.inputs[0]?.prompt).not.toContain("concise local classroom assistant");
    expect(runtime.inputs[0]?.prompt).not.toContain("No summary context.");
    expect(runtime.inputs[0]?.prompt).not.toContain("No image analysis context.");
    expect(runtime.requestOptions[0]).toMatchObject({
      search: {
        doSample: false,
        temperature: 0,
        seed: 42,
        earlyStopping: true,
        maxOutputTokens: 180,
      },
      toolChoice: "none",
    });
    expect(runtime.requestOptions[0]?.search).not.toHaveProperty("frequencyPenalty");
    expect(runtime.requestOptions[0]?.search).not.toHaveProperty("presencePenalty");
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

  it("zeroes the selected copy exactly once without mutating its Buffer source", () => {
    const source = Buffer.from([1, 2, 3]);
    const lifecycle = new TrackingImageByteLifecycle();
    const controller = new AssistantController({
      getTranscript: () => snapshot({}),
      runtime: new FakeRuntime("answer"),
      imageByteLifecycle: lifecycle,
    });
    controller.selectImage({ ...image(), bytes: source }, "data:image/png;base64,abc");
    const selectedCopy = lifecycle.copies("selected-image")[0] as Uint8Array;

    source.fill(9);
    expect(selectedCopy).toEqual(new Uint8Array([1, 2, 3]));

    controller.removeImage();
    controller.shutdown();

    expect(selectedCopy).toEqual(new Uint8Array([0, 0, 0]));
    expect(lifecycle.releaseCount(selectedCopy, "selected-image")).toBe(1);
    expect(source).toEqual(Buffer.from([9, 9, 9]));
  });

  it("keeps the committed controller copy after picker cleanup zeroes Node Buffer inputs", async () => {
    const filePath = path.resolve("fixtures", "ode-slide.png");
    const fileBytes = await readFile(filePath);
    const pngSignature = Uint8Array.from(fileBytes.subarray(0, 8));
    let validatedBytes: Uint8Array | null = null;
    const runtime = new FakeRuntime(
      "Visible text/objects: ODE slide\nRelation to lesson: Equation\nUncertainty: None",
    );
    const controller = new AssistantController({
      getTranscript: () => snapshot({ finalText: "lesson", version: 1 }),
      runtime,
    });

    const selected = await pickAssistantImage(
      {
        showDialog: async () => ({ canceled: false, filePaths: [filePath] }),
        stat: async () => ({ size: fileBytes.byteLength }),
        readFile: async () => fileBytes,
        createThumbnail: async (image) => {
          validatedBytes = image.bytes;
          return "data:image/png;base64,abc";
        },
      },
      {
        assertCurrent: () => {},
        commit: (image, thumbnailDataUrl) => controller.selectImage(image, thumbnailDataUrl),
      },
    );

    expect(Buffer.isBuffer(fileBytes)).toBe(true);
    expect(selected?.image?.basename).toBe("ode-slide.png");
    expect(fileBytes.every((value) => value === 0)).toBe(true);
    expect(validatedBytes).not.toBeNull();
    expect((validatedBytes as unknown as Uint8Array).every((value) => value === 0)).toBe(true);

    controller.startImageAnalysis("session-1", () => {});
    await vi.waitFor(() => expect(controller.snapshot().imageAnalysis).not.toBeNull());

    expect(runtime.imagePayloads[0]?.subarray(0, 8)).toEqual(pngSignature);
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
    expect(lifecycle.releaseCount(operationCopy as Uint8Array, "assistant-operation")).toBe(1);
  });

  it("releases a direct-image chat operation copy exactly once", async () => {
    const lifecycle = new TrackingImageByteLifecycle();
    const runtime = new FakeRuntime("The selected image shows an ODE.");
    const controller = new AssistantController({
      getTranscript: () => snapshot({ finalText: "lesson", version: 1 }),
      runtime,
      imageByteLifecycle: lifecycle,
    });
    controller.selectImage(image(), "data:image/png;base64,abc");

    controller.startChat("session-1", "Explain the selected image.", () => {});
    await vi.waitFor(() =>
      expect(controller.snapshot().chatMessages.some((message) => message.role === "assistant")).toBe(true),
    );

    const operationCopy = lifecycle.copies("assistant-operation")[0];
    expect(operationCopy).toEqual(new Uint8Array([0, 0, 0]));
    expect(lifecycle.isLive(operationCopy as Uint8Array)).toBe(false);
    expect(lifecycle.releaseCount(operationCopy as Uint8Array, "assistant-operation")).toBe(1);
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

  it("parses the captured Windows VLM response with all exact headings on one physical line", () => {
    expect(parseImageAnalysisNote(CAPTURED_WINDOWS_SINGLE_LINE_VLM_RESULT)).toEqual({
      visibleTextAndObjects:
        "The equation y' = -2y is presented as a first order decay model. 2. The graph shows exponential decay over time T. 3. The solution is y(T) = Yo * e^(-2T).",
      relationToLesson:
        "The equation relates a function to its derivative. 2. The graph illustrates the solution curve for the equation.",
      uncertainty: "None visible.",
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
    [
      "single-line reordered",
      "Uncertainty: None Relation to lesson: Lesson Visible text/objects: ODE",
      "sections must appear",
    ],
    ["single-line missing", "Visible text/objects: ODE Relation to lesson: Lesson", "sections must appear"],
    [
      "single-line conflicting duplicate",
      "Visible text/objects: ODE Visible text/objects: Different Relation to lesson: Lesson Uncertainty: None",
      "duplicated with conflicting content",
    ],
    [
      "non-heading inline phrase",
      "Visible text/objects: ODE Relationship to lesson: Lesson Uncertainty: None",
      "sections must appear",
    ],
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
    expect(() =>
      parseImageAnalysisNote(
        `Visible text/objects: ${"x".repeat(1_501)} Relation to lesson: Lesson Uncertainty: None`,
      ),
    ).toThrow("field bound");
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

const CAPTURED_WINDOWS_SINGLE_LINE_VLM_RESULT =
  "Visible text/objects: 1. The equation y' = -2y is presented as a first order decay model. 2. The graph shows exponential decay over time T. 3. The solution is y(T) = Yo * e^(-2T). Relation to lesson: 1. The equation relates a function to its derivative. 2. The graph illustrates the solution curve for the equation. Uncertainty: None visible.";

class FakeRuntime implements AssistantRuntime {
  assistantStatus: AssistantRuntimeStatus = {
    active: false,
    draining: false,
    visionModelId: null,
    cleanupDiagnostic: null,
  };
  readonly inputs: VisionChatTurnInput[] = [];
  readonly requestOptions: Array<RequestOptions | undefined> = [];
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
    options?: { readonly signal?: AbortSignal; readonly requestOptions?: RequestOptions },
  ): Promise<VisionChatTurnResult> {
    this.assistantStatus = {
      ...this.assistantStatus,
      active: true,
      draining: false,
    };
    const index = this.inputs.length;
    this.inputs.push(input);
    this.requestOptions.push(options?.requestOptions);
    for (const image of input.images ?? []) {
      if (image.kind === "data") {
        this.imagePayloads.push(Uint8Array.from(image.data));
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
  readonly #releaseCounts = new Map<Uint8Array, Map<AssistantImageBytePurpose, number>>();

  copy(source: Uint8Array, purpose: AssistantImageBytePurpose): Uint8Array {
    const bytes = Uint8Array.from(source);
    const copies = this.#copies.get(purpose) ?? [];
    copies.push(bytes);
    this.#copies.set(purpose, copies);
    this.#live.add(bytes);
    return bytes;
  }

  release(bytes: Uint8Array, purpose: AssistantImageBytePurpose): void {
    const counts = this.#releaseCounts.get(bytes) ?? new Map<AssistantImageBytePurpose, number>();
    counts.set(purpose, (counts.get(purpose) ?? 0) + 1);
    this.#releaseCounts.set(bytes, counts);
    bytes.fill(0);
    this.#live.delete(bytes);
  }

  copies(purpose: AssistantImageBytePurpose): readonly Uint8Array[] {
    return this.#copies.get(purpose) ?? [];
  }

  isLive(bytes: Uint8Array): boolean {
    return this.#live.has(bytes);
  }

  releaseCount(bytes: Uint8Array, purpose: AssistantImageBytePurpose): number {
    return this.#releaseCounts.get(bytes)?.get(purpose) ?? 0;
  }
}
