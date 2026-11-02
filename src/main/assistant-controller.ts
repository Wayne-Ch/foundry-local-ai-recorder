import { randomUUID } from "node:crypto";
import type { RequestOptions } from "foundry-local-sdk";
import { buildAssistantContext, buildImageAnalysisContext } from "../assistant/assistant-context";
import { assistantSystemPrompt, chatUserPrompt, imageAnalysisPrompt } from "../assistant/assistant-prompts";
import { AssistantCancelledError, AssistantOperationQueue } from "../assistant/assistant-queue";
import { AssistantMemoryState } from "../assistant/assistant-state";
import type {
  AssistantLaneSnapshot,
  AssistantMode,
  AssistantOperationToken,
  AssistantRequestContext,
  ImageAnalysisNote,
} from "../assistant/assistant-types";
import {
  type AssistantImageByteLifecycle,
  secureAssistantImageByteLifecycle,
} from "../assistant/image-byte-lifecycle";
import type { ValidatedImage } from "../assistant/image-security";
import { formatAssistantPlainText } from "../assistant/plain-text";
import type { AssistantRuntimeStatus } from "../foundry/foundry-runtime";
import type { VisionChatTurnInput, VisionChatTurnResult } from "../foundry/optional-vision-chat-runtime";
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
  readonly imageByteLifecycle?: AssistantImageByteLifecycle;
}

export interface StartedAssistantRequest {
  readonly requestId: string;
  readonly snapshot: AssistantLaneSnapshot;
}

export interface AssistantImagePickerToken {
  readonly ownerSessionId: string;
  readonly generation: number;
  readonly imageVersion: number;
}

export interface AssistantContextSynchronization {
  readonly changed: boolean;
  readonly snapshot: AssistantLaneSnapshot;
}

type UpdateCallback = (snapshot: AssistantLaneSnapshot) => void;

export class AssistantController {
  readonly #state = new AssistantMemoryState();
  readonly #queue = new AssistantOperationQueue();
  readonly #runtime: AssistantRuntime;
  readonly #getTranscript: () => TranscriptSnapshot;
  readonly #imageByteLifecycle: AssistantImageByteLifecycle;
  #imageBytes: {
    readonly imageId: string;
    readonly imageVersion: number;
    readonly bytes: Uint8Array;
  } | null = null;
  #transcriptContextFingerprint: string;

  constructor(options: AssistantControllerOptions) {
    this.#runtime = options.runtime;
    this.#getTranscript = options.getTranscript;
    this.#imageByteLifecycle = options.imageByteLifecycle ?? secureAssistantImageByteLifecycle;
    this.#transcriptContextFingerprint = buildImageAnalysisContext(this.#getTranscript()).fingerprint;
  }

  snapshot(): AssistantLaneSnapshot {
    this.#synchronizeTranscriptContext();
    return this.#snapshot();
  }

  synchronizeTranscriptContext(): AssistantContextSynchronization {
    const changed = this.#synchronizeTranscriptContext();
    return { changed, snapshot: this.#snapshot() };
  }

  #snapshot(): AssistantLaneSnapshot {
    const snapshot = this.#state.snapshot(this.#queue);
    const runtimeStatus = this.#runtime.assistantStatus;
    const cleanupPending = this.#queue.draining || runtimeStatus.draining;
    return {
      ...snapshot,
      cleanupPending,
      cleanupDetail: cleanupPending
        ? runtimeStatus.cleanupDiagnostic === null
          ? "Optional assistant cleanup is draining; recording, transcription, and summary remain available."
          : `Optional assistant cleanup is draining after a native cleanup error; recording, transcription, and summary remain available. ${formatSafeDiagnostic(
              runtimeStatus.cleanupDiagnostic,
            )}`
        : null,
    };
  }

  setMode(mode: AssistantMode): AssistantLaneSnapshot {
    if (mode !== "classroom" && mode !== "clinic") {
      throw new Error("Assistant mode must be classroom or clinic.");
    }
    if (this.#state.snapshot().mode !== mode) {
      this.#queue.cancelAll("The assistant mode changed.");
      this.#runtime.cancelAssistantOperations(new Error("Assistant mode change cancelled optional work."));
      this.#state.setMode(mode);
    }
    return this.snapshot();
  }

  captureImagePickerToken(ownerSessionId: string): AssistantImagePickerToken {
    const snapshot = this.#state.snapshot();
    return {
      ownerSessionId,
      generation: snapshot.generation,
      imageVersion: this.#state.imageVersion,
    };
  }

  assertImagePickerToken(token: AssistantImagePickerToken): void {
    if (!this.#state.isImagePickerTokenCurrent(token.generation, token.imageVersion)) {
      throw new Error("The image selection belongs to stale assistant state.");
    }
  }

  selectImage(
    image: ValidatedImage,
    thumbnailDataUrl: string,
    pickerToken?: AssistantImagePickerToken,
  ): AssistantLaneSnapshot {
    if (!thumbnailDataUrl.startsWith("data:image/png;base64,")) {
      throw new Error("The generated image thumbnail has an unexpected media type.");
    }
    if (pickerToken !== undefined) {
      this.assertImagePickerToken(pickerToken);
    }
    this.#queue.cancelImageDependent();
    const ownedBytes = this.#imageByteLifecycle.copy(image.bytes, "selected-image");
    let committed = false;
    try {
      this.#disposeImageBytes();
      const selected = this.#state.selectImage({
        basename: image.basename,
        mimeType: image.mimeType,
        sizeBytes: image.sizeBytes,
        width: image.width,
        height: image.height,
        thumbnailDataUrl,
      });
      this.#imageBytes = {
        imageId: selected.id,
        imageVersion: selected.version,
        bytes: ownedBytes,
      };
      committed = true;
    } finally {
      if (!committed) {
        this.#imageByteLifecycle.release(ownedBytes, "selected-image");
      }
    }
    return this.snapshot();
  }

  removeImage(): AssistantLaneSnapshot {
    this.#queue.cancelImageDependent();
    this.#disposeImageBytes();
    this.#state.removeImage();
    return this.snapshot();
  }

  startImageAnalysis(ownerSessionId: string, onUpdate: UpdateCallback): StartedAssistantRequest {
    this.#synchronizeTranscriptContext();
    this.#queue.cancelKind("image_analysis");
    const image = this.#state.snapshot().image;
    if (image === null || this.#imageBytes === null) {
      throw new Error("Select a current lesson image before analysis.");
    }
    const context = buildImageAnalysisContext(this.#getTranscript());
    const token = this.#state.createOperationToken(randomUUID(), "image_analysis", context, {
      dependsOnImage: true,
      requiresImageBytes: true,
    });
    const queued = this.#queue.enqueue(ownerSessionId, token, async (signal, operationToken) => {
      const currentContext = buildImageAnalysisContext(this.#getTranscript());
      this.#assertImageAnalysisOperationCurrent(operationToken, currentContext, signal);
      const ownedImage = this.#copyOperationImage(operationToken);
      try {
        const result = await this.#runTurn(
          {
            prompt: imageAnalysisPrompt(operationToken.mode, operationToken.context),
            systemPrompt: assistantSystemPrompt(operationToken.mode),
            images: [
              {
                kind: "data",
                format: imageFormat(ownedImage.image.mimeType),
                data: ownedImage.bytes,
              },
            ],
          },
          signal,
          IMAGE_REQUEST_OPTIONS,
        );
        const note = parseImageAnalysisNote(result.text);
        const completionContext = buildImageAnalysisContext(this.#getTranscript());
        if (
          !signal.aborted &&
          this.#state.applyImageAnalysis(operationToken, completionContext, note, result.model.modelId)
        ) {
          this.#state.trace("image-analysis-raw", result.text, "info", operationToken.requestId);
        } else if (this.#state.isGenerationCurrent(operationToken)) {
          this.#state.trace(
            "image-analysis-stale",
            "Discarded image analysis because the selected image or lesson context changed.",
            "warning",
            operationToken.requestId,
          );
        }
      } finally {
        this.#imageByteLifecycle.release(ownedImage.bytes, "assistant-operation");
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
    this.#synchronizeTranscriptContext();
    const transcript = this.#getTranscript();
    const analysisContext = buildImageAnalysisContext(transcript);
    const validImageAnalysis = this.#state.validImageAnalysis(analysisContext);
    const context = buildAssistantContext(transcript, validImageAnalysis);
    const stateBefore = this.#state.snapshot();
    const asksAboutImage = isImageQuestion(normalizedQuestion);
    if (asksAboutImage && stateBefore.image === null) {
      throw new Error("Select an image before asking an image-specific question.");
    }
    const dependsOnImage = asksAboutImage || validImageAnalysis !== null;
    const token = this.#state.createOperationToken(randomUUID(), "chat", context, {
      dependsOnImage,
      requiresImageBytes: asksAboutImage,
    });
    const history = this.#state.chatHistoryFor(token);
    const queued = this.#queue.enqueue(ownerSessionId, token, async (signal, operationToken) => {
      this.#assertChatOperationCurrent(operationToken, signal);
      const ownedImage = operationToken.requiresImageBytes ? this.#copyOperationImage(operationToken) : null;
      try {
        const input: VisionChatTurnInput = {
          prompt: chatUserPrompt(normalizedQuestion, operationToken.context, history),
          systemPrompt: assistantSystemPrompt(operationToken.mode),
          ...(ownedImage === null
            ? {}
            : {
                images: [
                  {
                    kind: "data" as const,
                    format: imageFormat(ownedImage.image.mimeType),
                    data: ownedImage.bytes,
                  },
                ],
              }),
        };
        const result = await this.#runTurn(input, signal, CHAT_REQUEST_OPTIONS);
        const answer = formatAssistantPlainText(result.text);
        if (!signal.aborted && this.#state.applyChatAnswer(operationToken, answer)) {
          this.#state.trace("chat-raw", result.text, "info", operationToken.requestId);
        } else if (this.#state.isGenerationCurrent(operationToken)) {
          this.#state.trace(
            "chat-stale",
            "Discarded a chat answer because assistant state changed.",
            "warning",
            operationToken.requestId,
          );
        }
      } finally {
        if (ownedImage !== null) {
          this.#imageByteLifecycle.release(ownedImage.bytes, "assistant-operation");
        }
      }
    });
    this.#state.appendUserMessage(token, normalizedQuestion);
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
    this.#transcriptContextFingerprint = buildImageAnalysisContext(this.#getTranscript()).fingerprint;
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
    this.#transcriptContextFingerprint = buildImageAnalysisContext(this.#getTranscript()).fingerprint;
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
    if (this.#imageBytes !== null) {
      this.#imageByteLifecycle.release(this.#imageBytes.bytes, "selected-image");
    }
    this.#imageBytes = null;
  }

  #copyOperationImage(token: AssistantOperationToken): {
    readonly image: NonNullable<AssistantLaneSnapshot["image"]>;
    readonly bytes: Uint8Array;
  } {
    const image = this.#state.snapshot().image;
    const owned = this.#imageBytes;
    if (
      !token.dependsOnImage ||
      !token.requiresImageBytes ||
      image === null ||
      owned === null ||
      token.imageId !== image.id ||
      token.imageVersion !== image.version ||
      owned.imageId !== image.id ||
      owned.imageVersion !== image.version
    ) {
      throw new AssistantCancelledError("The selected image changed before assistant execution.");
    }
    return {
      image,
      bytes: this.#imageByteLifecycle.copy(owned.bytes, "assistant-operation"),
    };
  }

  #assertChatOperationCurrent(token: AssistantOperationToken, signal: AbortSignal): void {
    if (signal.aborted || !this.#state.isChatOperationCurrent(token)) {
      throw new AssistantCancelledError(
        "The assistant chat request no longer matches the current mode, image, or renderer session.",
      );
    }
  }

  #assertImageAnalysisOperationCurrent(
    token: AssistantOperationToken,
    currentContext: AssistantRequestContext,
    signal: AbortSignal,
  ): void {
    if (signal.aborted || !this.#state.isImageAnalysisOperationCurrent(token, currentContext)) {
      throw new AssistantCancelledError(
        "The assistant request no longer matches the current mode, image, or lesson context.",
      );
    }
  }

  #synchronizeTranscriptContext(): boolean {
    const context = buildImageAnalysisContext(this.#getTranscript());
    const contextChanged = context.fingerprint !== this.#transcriptContextFingerprint;
    this.#transcriptContextFingerprint = context.fingerprint;
    const invalidated = this.#state.invalidateImageAnalysis(context);
    const cancelled = contextChanged ? this.#queue.cancelKind("image_analysis") : false;
    if (invalidated) {
      this.#state.trace(
        "image-analysis-stale",
        "Stored image analysis was marked unavailable because the transcript context changed.",
        "warning",
      );
    }
    if (cancelled && !invalidated) {
      this.#state.trace(
        "assistant-context-stale",
        "Cancelled image analysis because the transcript context changed.",
        "warning",
      );
    }
    return invalidated || cancelled;
  }
}

export function parseImageAnalysisNote(raw: string): ImageAnalysisNote {
  const text = formatAssistantPlainText(raw);
  const occurrences = new Map<ImageAnalysisSection, string[]>();
  const firstSeenOrder: ImageAnalysisSection[] = [];
  let current: { readonly section: ImageAnalysisSection; readonly entries: string[] } | null = null;

  const finishCurrent = (): void => {
    if (current === null) {
      return;
    }
    const value = current.entries
      .map((entry) => entry.trim())
      .filter(Boolean)
      .join("\n");
    if (!value) {
      throw imageAnalysisParseError(`${sectionHeading(current.section)} is empty`);
    }
    if (value.length > MAX_IMAGE_ANALYSIS_FIELD_CHARS) {
      throw imageAnalysisParseError(`${sectionHeading(current.section)} exceeds the field bound`);
    }
    const values = occurrences.get(current.section) ?? [];
    values.push(value);
    occurrences.set(current.section, values);
    current = null;
  };

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const heading = parseSectionHeading(trimmed);
    if (heading !== null) {
      finishCurrent();
      if (!occurrences.has(heading.section) && !firstSeenOrder.includes(heading.section)) {
        firstSeenOrder.push(heading.section);
      }
      current = { section: heading.section, entries: [] };
      if (heading.inlineValue) {
        current.entries.push(stripListMarker(heading.inlineValue).value);
      }
      continue;
    }
    if (current === null) {
      throw imageAnalysisParseError("unexpected text appears outside a required section");
    }
    const content = stripListMarker(trimmed);
    if (!content.value) {
      continue;
    }
    if (content.listItem || current.entries.length === 0) {
      current.entries.push(content.value);
    } else {
      const lastIndex = current.entries.length - 1;
      current.entries[lastIndex] = `${current.entries[lastIndex]} ${content.value}`.trim();
    }
  }
  finishCurrent();

  if (
    firstSeenOrder.length !== IMAGE_ANALYSIS_SECTION_ORDER.length ||
    firstSeenOrder.some((section, index) => section !== IMAGE_ANALYSIS_SECTION_ORDER[index])
  ) {
    throw imageAnalysisParseError(
      "sections must appear in Visible text/objects, Relation to lesson, Uncertainty order",
    );
  }

  const visibleTextAndObjects = resolveSection(occurrences, "visibleTextAndObjects");
  const relationToLesson = resolveSection(occurrences, "relationToLesson");
  const uncertainty = resolveSection(occurrences, "uncertainty");
  if (
    visibleTextAndObjects.length + relationToLesson.length + uncertainty.length >
    MAX_IMAGE_ANALYSIS_TOTAL_CHARS
  ) {
    throw imageAnalysisParseError("combined fields exceed the total bound");
  }

  return { visibleTextAndObjects, relationToLesson, uncertainty };
}

type ImageAnalysisSection = keyof ImageAnalysisNote;

const IMAGE_ANALYSIS_SECTION_ORDER = [
  "visibleTextAndObjects",
  "relationToLesson",
  "uncertainty",
] as const satisfies readonly ImageAnalysisSection[];
const MAX_IMAGE_ANALYSIS_FIELD_CHARS = 1_500;
const MAX_IMAGE_ANALYSIS_TOTAL_CHARS = 3_000;

function parseSectionHeading(
  line: string,
): { readonly section: ImageAnalysisSection; readonly inlineValue: string } | null {
  const match = /^(visible\s+text\s*\/\s*objects|relation\s+to\s+lesson|uncertainty)\s*:\s*(.*)$/iu.exec(
    line,
  );
  if (match === null) {
    return null;
  }
  const normalized = match[1]
    ?.toLowerCase()
    .replaceAll(/\s+/g, " ")
    .replaceAll(/\s*\/\s*/g, "/");
  const section =
    normalized === "visible text/objects"
      ? "visibleTextAndObjects"
      : normalized === "relation to lesson"
        ? "relationToLesson"
        : "uncertainty";
  return { section, inlineValue: match[2]?.trim() ?? "" };
}

function stripListMarker(value: string): { readonly value: string; readonly listItem: boolean } {
  const match = /^(?:[-*•]\s+|\d{1,3}[.)]\s+)(.*)$/u.exec(value.trim());
  return match === null
    ? { value: value.trim(), listItem: false }
    : { value: match[1]?.trim() ?? "", listItem: true };
}

function resolveSection(
  occurrences: ReadonlyMap<ImageAnalysisSection, readonly string[]>,
  section: ImageAnalysisSection,
): string {
  const values = occurrences.get(section);
  if (values === undefined || values.length === 0) {
    throw imageAnalysisParseError(`${sectionHeading(section)} is missing`);
  }
  const distinct = [...new Set(values)];
  if (distinct.length > 1) {
    throw imageAnalysisParseError(`${sectionHeading(section)} is duplicated with conflicting content`);
  }
  return distinct[0] ?? "";
}

function sectionHeading(section: ImageAnalysisSection): string {
  switch (section) {
    case "visibleTextAndObjects":
      return "Visible text/objects";
    case "relationToLesson":
      return "Relation to lesson";
    case "uncertainty":
      return "Uncertainty";
  }
}

function imageAnalysisParseError(reason: string): Error {
  return new Error(`The local image model did not return the required structured note: ${reason}.`);
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
