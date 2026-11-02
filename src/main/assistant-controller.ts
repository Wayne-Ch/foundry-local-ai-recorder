import type { RequestOptions } from "foundry-local-sdk";
import { buildAssistantContext, buildImageAnalysisContext } from "../assistant/assistant-context";
import { assistantSystemPrompt, chatUserPrompt, imageAnalysisPrompt } from "../assistant/assistant-prompts";
import { AssistantCancelledError, AssistantOperationQueue } from "../assistant/assistant-queue";
import { AssistantMemoryState } from "../assistant/assistant-state";
import type { AssistantLaneSnapshot, AssistantMode, ImageAnalysisNote } from "../assistant/assistant-types";
import type { ValidatedImage } from "../assistant/image-security";
import { formatAssistantPlainText } from "../assistant/plain-text";
import type { AssistantRuntimeStatus } from "../foundry/foundry-runtime";
import type {
  VisionChatTurnInput,
  VisionChatTurnResult,
} from "../foundry/optional-vision-chat-runtime";
import { formatSafeDiagnostic, toSafeDiagnostic } from "../shared/safe-diagnostic";
import type { TranscriptSnapshot } from "../transcript/transcript-store";

const CHAT_REQUEST_OPTIONS: RequestOptions = {
  search: {
    doSample: false,
    temperature: 0,
    seed: 42,
    maxOutputTokens: 180,
  },
  toolChoice: "none",
  additionalOptions: {
    chat_template_kwargs: JSON.stringify({ enable_thinking: false }),
  },
};

const IMAGE_REQUEST_OPTIONS: RequestOptions = {
  ...CHAT_REQUEST_OPTIONS,
  search: {
    ...CHAT_REQUEST_OPTIONS.search,
    maxOutputTokens: 280,
  },
};

export interface AssistantRuntime {
  readonly assistantStatus: AssistantRuntimeStatus;
  runAssistantTurn(
    input: VisionChatTurnInput,
    options?: { readonly signal?: AbortSignal; readonly requestOptions?: RequestOptions },
  ): Promise<VisionChatTurnResult>;
  cancelAssistantOperations(reason?: unknown): Promise<void> | null;
  resetAssistant(): Promise<void>;
}

export interface AssistantControllerOptions {
  readonly runtime: AssistantRuntime;
  readonly getTranscript: () => TranscriptSnapshot;
}

export interface StartedAssistantRequest {
  readonly requestId: string;
  readonly snapshot: AssistantLaneSnapshot;
}

type UpdateCallback = (snapshot: AssistantLaneSnapshot) => void;

export class AssistantController {
  readonly #state = new AssistantMemoryState();
  readonly #queue = new AssistantOperationQueue();
  readonly #runtime: AssistantRuntime;
  readonly #getTranscript: () => TranscriptSnapshot;
  #imageBytes: Uint8Array | null = null;

  constructor(options: AssistantControllerOptions) {
    this.#runtime = options.runtime;
    this.#getTranscript = options.getTranscript;
  }

  snapshot(): AssistantLaneSnapshot {
    const snapshot = this.#state.snapshot(this.#queue);
    const cleanupPending = this.#queue.draining || this.#runtime.assistantStatus.draining;
    return {
      ...snapshot,
      cleanupPending,
      cleanupDetail: cleanupPending
        ? "Optional assistant cleanup is draining; recording, transcription, and summary remain available."
        : null,
    };
  }

  setMode(mode: AssistantMode): AssistantLaneSnapshot {
    if (mode !== "classroom" && mode !== "clinic") {
      throw new Error("Assistant mode must be classroom or clinic.");
    }
    if (this.#state.snapshot().mode !== mode) {
      this.#queue.cancelKind("chat");
      this.#queue.cancelKind("image_analysis");
    }
    this.#state.setMode(mode);
    return this.snapshot();
  }

  selectImage(image: ValidatedImage, thumbnailDataUrl: string): AssistantLaneSnapshot {
    if (!thumbnailDataUrl.startsWith("data:image/png;base64,")) {
      throw new Error("The generated image thumbnail has an unexpected media type.");
    }
    this.#queue.cancelKind("image_analysis");
    this.#disposeImageBytes();
    this.#imageBytes = image.bytes.slice();
    this.#state.selectImage({
      basename: image.basename,
      mimeType: image.mimeType,
      sizeBytes: image.sizeBytes,
      width: image.width,
      height: image.height,
      thumbnailDataUrl,
    });
    return this.snapshot();
  }

  removeImage(): AssistantLaneSnapshot {
    this.#queue.cancelKind("image_analysis");
    this.#disposeImageBytes();
    this.#state.removeImage();
    return this.snapshot();
  }

  startImageAnalysis(ownerSessionId: string, onUpdate: UpdateCallback): StartedAssistantRequest {
    this.#queue.cancelKind("image_analysis");
    const image = this.#state.snapshot().image;
    if (image === null || this.#imageBytes === null) {
      throw new Error("Select a current lesson image before analysis.");
    }
    const context = buildImageAnalysisContext(this.#getTranscript());
    const mode = this.#state.snapshot().mode;
    const imageBytes = this.#imageBytes.slice();
    const queued = this.#queue.enqueue(ownerSessionId, "image_analysis", async (signal, requestId) => {
      const token = this.#state.beginOperation(requestId, "image_analysis", context);
      try {
        const result = await this.#runTurn(
          {
            prompt: imageAnalysisPrompt(mode, context),
            systemPrompt: assistantSystemPrompt(mode),
            images: [
              {
                kind: "data",
                format: imageFormat(image.mimeType),
                data: imageBytes,
              },
            ],
          },
          signal,
          IMAGE_REQUEST_OPTIONS,
        );
        const note = parseImageAnalysisNote(result.text);
        const currentContext = buildImageAnalysisContext(this.#getTranscript());
        if (this.#state.applyImageAnalysis(token, currentContext, note, result.model.modelId)) {
          this.#state.trace("image-analysis-raw", result.text, "info", requestId);
        } else if (this.#state.isGenerationCurrent(token)) {
          this.#state.trace(
            "image-analysis-stale",
            "Discarded image analysis because the selected image or lesson context changed.",
            "warning",
            requestId,
          );
        }
      } finally {
        imageBytes.fill(0);
      }
    });
    this.#watch(queued.result, queued.requestId, onUpdate);
    onUpdate(this.snapshot());
    queueMicrotask(() => onUpdate(this.snapshot()));
    return { requestId: queued.requestId, snapshot: this.snapshot() };
  }

  startChat(ownerSessionId: string, question: string, onUpdate: UpdateCallback): StartedAssistantRequest {
    const normalizedQuestion = question.trim();
    if (!normalizedQuestion) {
      throw new Error("Enter a question for the local assistant.");
    }
    if (normalizedQuestion.length > 1_000) {
      throw new Error("Assistant questions are limited to 1,000 characters.");
    }
    const stateBefore = this.#state.snapshot();
    const asksAboutImage = isImageQuestion(normalizedQuestion);
    if (asksAboutImage && stateBefore.image === null) {
      throw new Error("Select an image before asking an image-specific question.");
    }
    const context = buildAssistantContext(this.#getTranscript(), this.#state.imageAnalysis);
    const mode = stateBefore.mode;
    const history = this.#state.chatMessages;
    const directImageBytes = asksAboutImage && this.#imageBytes !== null ? this.#imageBytes.slice() : null;
    const selectedImage = stateBefore.image;
    const queued = this.#queue.enqueue(ownerSessionId, "chat", async (signal, requestId) => {
      const token = this.#state.beginOperation(requestId, "chat", context);
      try {
        const input: VisionChatTurnInput = {
          prompt: chatUserPrompt(normalizedQuestion, context, history),
          systemPrompt: assistantSystemPrompt(mode),
          ...(directImageBytes === null || selectedImage === null
            ? {}
            : {
                images: [
                  {
                    kind: "data" as const,
                    format: imageFormat(selectedImage.mimeType),
                    data: directImageBytes,
                  },
                ],
              }),
        };
        const result = await this.#runTurn(input, signal, CHAT_REQUEST_OPTIONS);
        const answer = formatAssistantPlainText(result.text);
        if (this.#state.applyChatAnswer(token, answer, context)) {
          this.#state.trace("chat-raw", result.text, "info", requestId);
        } else if (this.#state.isGenerationCurrent(token)) {
          this.#state.trace(
            "chat-stale",
            "Discarded a chat answer because assistant state changed.",
            "warning",
            requestId,
          );
        }
      } finally {
        directImageBytes?.fill(0);
      }
    });
    this.#state.appendUserMessage(queued.requestId, normalizedQuestion, context);
    this.#watch(queued.result, queued.requestId, onUpdate);
    onUpdate(this.snapshot());
    queueMicrotask(() => onUpdate(this.snapshot()));
    return { requestId: queued.requestId, snapshot: this.snapshot() };
  }

  cancel(requestId: string): AssistantLaneSnapshot {
    this.#queue.cancel(requestId);
    return this.snapshot();
  }

  clearChat(): AssistantLaneSnapshot {
    this.#queue.cancelKind("chat");
    this.#state.clearChat();
    return this.snapshot();
  }

  revokeSession(sessionId: string): void {
    this.#queue.cancelOwner(sessionId);
  }

  reset(onUpdate?: UpdateCallback): AssistantLaneSnapshot {
    this.#queue.reset();
    const cleanup = this.#runtime.resetAssistant();
    this.#disposeImageBytes();
    this.#state.reset();
    void cleanup.then(
      () => onUpdate?.(this.snapshot()),
      (error: unknown) => {
        this.#state.trace(
          "assistant-cleanup",
          formatSafeDiagnostic(toSafeDiagnostic(error, "OPTIONAL_ASSISTANT_CLEANUP_PENDING")),
          "warning",
        );
        onUpdate?.(this.snapshot());
      },
    );
    return this.snapshot();
  }

  shutdown(): void {
    this.#queue.reset();
    this.#runtime.cancelAssistantOperations(new Error("Assistant shutdown cancelled optional work."));
    this.#disposeImageBytes();
    this.#state.reset();
  }

  async #runTurn(
    input: VisionChatTurnInput,
    signal: AbortSignal,
    requestOptions: RequestOptions,
  ): Promise<VisionChatTurnResult> {
    return this.#runtime.runAssistantTurn(input, { signal, requestOptions });
  }

  #watch(result: Promise<void>, requestId: string, onUpdate: UpdateCallback): void {
    void result.then(
      () => {
        onUpdate(this.snapshot());
        queueMicrotask(() => onUpdate(this.snapshot()));
      },
      (error: unknown) => {
        if (!(error instanceof AssistantCancelledError)) {
          this.#state.trace(
            "assistant-failure",
            formatSafeDiagnostic(toSafeDiagnostic(error, "OPTIONAL_ASSISTANT_FAILED")),
            "error",
            requestId,
          );
        }
        onUpdate(this.snapshot());
        queueMicrotask(() => onUpdate(this.snapshot()));
      },
    );
  }

  #disposeImageBytes(): void {
    this.#imageBytes?.fill(0);
    this.#imageBytes = null;
  }
}

export function parseImageAnalysisNote(raw: string): ImageAnalysisNote {
  const text = formatAssistantPlainText(raw);
  const fields = new Map<string, string>();
  for (const line of text.split("\n")) {
    const separator = line.indexOf(":");
    if (separator <= 0) {
      continue;
    }
    fields.set(line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim());
  }
  const visibleTextAndObjects = fields.get("visible text/objects");
  const relationToLesson = fields.get("relation to lesson");
  const uncertainty = fields.get("uncertainty");
  if (!visibleTextAndObjects || !relationToLesson || !uncertainty) {
    throw new Error("The local image model did not return the required structured note.");
  }
  return { visibleTextAndObjects, relationToLesson, uncertainty };
}

function imageFormat(mimeType: "image/png" | "image/jpeg" | "image/webp"): string {
  switch (mimeType) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpeg";
    case "image/webp":
      return "webp";
  }
}

function isImageQuestion(question: string): boolean {
  return /\b(image|picture|slide|diagram|screenshot|figure|photo|x-ray|xray|selected|shown|visible|show)\b/iu.test(
    question,
  );
}
