import { randomUUID } from "node:crypto";
import { durableChatMessageContext } from "./assistant-context";
import { type AssistantOperationQueue, DEFAULT_MAX_ASSISTANT_QUEUE } from "./assistant-queue";
import type {
  AssistantChatMessage,
  AssistantLaneSnapshot,
  AssistantMode,
  AssistantOperationKind,
  AssistantOperationToken,
  AssistantRequestContext,
  AssistantTraceEntry,
  ImageAnalysisNote,
  ImageAnalysisSnapshot,
} from "./assistant-types";

const TRACE_LIMIT = 120;
const CHAT_LIMIT = 80;

export interface ImageSelectionInput {
  readonly basename: string;
  readonly mimeType: "image/png" | "image/jpeg" | "image/webp";
  readonly sizeBytes: number;
  readonly width: number;
  readonly height: number;
  readonly thumbnailDataUrl: string;
}

interface StoredAssistantChatMessage {
  readonly visible: AssistantChatMessage;
  readonly historyText: string;
}

export class AssistantMemoryState {
  #generation = 0;
  #chatGeneration = 0;
  #mode: AssistantMode = "classroom";
  #imageVersion = 0;
  #analysisVersion = 0;
  #image: AssistantLaneSnapshot["image"] = null;
  #imageAnalysis: ImageAnalysisSnapshot | null = null;
  readonly #chatMessages: StoredAssistantChatMessage[] = [];
  readonly #trace: AssistantTraceEntry[] = [];

  snapshot(
    queue?: Pick<
      AssistantOperationQueue,
      "activeRequestId" | "activeOperation" | "pendingOperations" | "queuedRequests" | "maxQueuedRequests"
    >,
  ): AssistantLaneSnapshot {
    return {
      generation: this.#generation,
      mode: this.#mode,
      image: this.#image,
      imageAnalysis: this.#imageAnalysis,
      chatMessages: this.#chatMessages.map((message) => message.visible),
      activeRequestId: queue?.activeRequestId ?? null,
      activeOperation: queue?.activeOperation ?? null,
      pendingOperations: queue?.pendingOperations ?? [],
      queuedRequests: queue?.queuedRequests ?? 0,
      maxQueuedRequests: queue?.maxQueuedRequests ?? DEFAULT_MAX_ASSISTANT_QUEUE,
      cleanupPending: false,
      cleanupDetail: null,
      trace: [...this.#trace],
    };
  }

  setMode(mode: AssistantMode): void {
    if (mode === this.#mode) {
      return;
    }
    const previousMode = this.#mode;
    this.#generation += 1;
    this.#chatGeneration += 1;
    this.#mode = mode;
    this.#imageAnalysis = null;
    this.#markImageUnanalyzed();
    this.#chatMessages.length = 0;
    this.#trace.length = 0;
    this.trace(
      "mode-isolation",
      `Switched from ${previousMode} to ${mode}; prior assistant chat and image analysis were cleared, and the selected image requires re-analysis.`,
    );
  }

  selectImage(input: ImageSelectionInput): NonNullable<AssistantLaneSnapshot["image"]> {
    this.#imageVersion += 1;
    this.#image = {
      id: randomUUID(),
      version: this.#imageVersion,
      analysisStatus: "unanalyzed",
      ...input,
      selectedAt: new Date().toISOString(),
    };
    this.#imageAnalysis = null;
    return this.#image;
  }

  removeImage(): void {
    this.#imageVersion += 1;
    this.#image = null;
    this.#imageAnalysis = null;
  }

  createOperationToken(
    requestId: string,
    kind: AssistantOperationKind,
    context: AssistantRequestContext,
    options: {
      readonly dependsOnImage: boolean;
      readonly requiresImageBytes: boolean;
    },
  ): AssistantOperationToken {
    if (options.requiresImageBytes && !options.dependsOnImage) {
      throw new Error("Assistant image bytes require an image-dependent operation token.");
    }
    const image = options.dependsOnImage ? this.#image : null;
    if (options.dependsOnImage && image === null) {
      throw new Error("Select a current lesson image before starting this assistant request.");
    }
    const capturedContext = captureRequestContext(context);
    return {
      requestId,
      generation: this.#generation,
      laneGeneration: kind === "chat" ? this.#chatGeneration : this.#imageVersion,
      kind,
      mode: this.#mode,
      dependsOnImage: options.dependsOnImage,
      requiresImageBytes: options.requiresImageBytes,
      imageId: image?.id ?? null,
      imageVersion: image?.version ?? null,
      contextFingerprint: capturedContext.fingerprint,
      context: capturedContext,
    };
  }

  applyImageAnalysis(
    token: AssistantOperationToken,
    currentContext: AssistantRequestContext,
    note: ImageAnalysisNote,
    modelId: string,
  ): boolean {
    if (
      token.kind !== "image_analysis" ||
      !this.isImageAnalysisOperationCurrent(token, currentContext) ||
      token.imageId === null ||
      token.imageVersion === null
    ) {
      return false;
    }
    this.#analysisVersion += 1;
    this.#imageAnalysis = {
      ...note,
      version: this.#analysisVersion,
      imageId: token.imageId,
      imageVersion: token.imageVersion,
      contextLabels: durableChatMessageContext(currentContext),
      contextFingerprint: currentContext.fingerprint,
      mode: token.mode,
      modelId,
      generatedAt: new Date().toISOString(),
    };
    if (this.#image !== null) {
      this.#image = { ...this.#image, analysisStatus: "ready" };
    }
    return true;
  }

  appendUserMessage(token: AssistantOperationToken, question: string): AssistantChatMessage {
    if (token.kind !== "chat") {
      throw new Error("Only chat operation tokens can append chat history.");
    }
    const message: AssistantChatMessage = {
      id: randomUUID(),
      requestId: token.requestId,
      role: "user",
      text: question.trim(),
      mode: token.mode,
      contextFingerprint: token.contextFingerprint,
      dependsOnImage: token.dependsOnImage,
      imageId: token.imageId,
      imageVersion: token.imageVersion,
      contextLabels: durableChatMessageContext(token.context),
      createdAt: new Date().toISOString(),
    };
    this.#appendChat({ visible: message, historyText: message.text });
    return message;
  }

  applyChatAnswer(
    token: AssistantOperationToken,
    visibleAnswer: string,
    historyAnswer: string = visibleAnswer,
  ): boolean {
    if (!this.isChatOperationCurrent(token)) {
      return false;
    }
    this.#appendChat({
      visible: {
        id: randomUUID(),
        requestId: token.requestId,
        role: "assistant",
        text: visibleAnswer,
        mode: token.mode,
        contextFingerprint: token.contextFingerprint,
        dependsOnImage: token.dependsOnImage,
        imageId: token.imageId,
        imageVersion: token.imageVersion,
        contextLabels: durableChatMessageContext(token.context),
        createdAt: new Date().toISOString(),
      },
      historyText: historyAnswer,
    });
    return true;
  }

  clearChat(): void {
    this.#chatGeneration += 1;
    this.#chatMessages.length = 0;
  }

  trace(
    phase: string,
    detail: string,
    severity: AssistantTraceEntry["severity"] = "info",
    requestId?: string,
  ): void {
    this.#trace.push({
      at: new Date().toISOString(),
      phase,
      detail,
      severity,
      ...(requestId === undefined ? {} : { requestId }),
    });
    if (this.#trace.length > TRACE_LIMIT) {
      this.#trace.splice(0, this.#trace.length - TRACE_LIMIT);
    }
  }

  reset(): void {
    this.#generation += 1;
    this.#chatGeneration += 1;
    this.#mode = "classroom";
    this.#imageVersion += 1;
    this.#image = null;
    this.#imageAnalysis = null;
    this.#chatMessages.length = 0;
    this.#trace.length = 0;
  }

  get imageAnalysis(): ImageAnalysisSnapshot | null {
    return this.#imageAnalysis;
  }

  get imageVersion(): number {
    return this.#imageVersion;
  }

  validImageAnalysis(currentContext: AssistantRequestContext): ImageAnalysisSnapshot | null {
    const analysis = this.#imageAnalysis;
    const image = this.#image;
    return analysis !== null &&
      image !== null &&
      analysis.mode === this.#mode &&
      analysis.imageId === image.id &&
      analysis.imageVersion === image.version &&
      analysis.contextFingerprint === currentContext.fingerprint
      ? analysis
      : null;
  }

  invalidateImageAnalysis(currentContext: AssistantRequestContext): boolean {
    if (this.#imageAnalysis === null || this.validImageAnalysis(currentContext) !== null) {
      return false;
    }
    this.#imageAnalysis = null;
    this.#markImageUnanalyzed();
    return true;
  }

  chatHistoryFor(token: AssistantOperationToken): readonly AssistantChatMessage[] {
    return this.#chatMessages
      .filter(
        (message) =>
          message.visible.mode === token.mode &&
          message.visible.contextFingerprint === token.contextFingerprint &&
          message.visible.dependsOnImage === token.dependsOnImage &&
          message.visible.imageId === token.imageId &&
          message.visible.imageVersion === token.imageVersion,
      )
      .map((message) => ({ ...message.visible, text: message.historyText }));
  }

  isChatOperationCurrent(token: AssistantOperationToken): boolean {
    return token.kind === "chat" && this.#isOperationStateCurrent(token);
  }

  isImageAnalysisOperationCurrent(
    token: AssistantOperationToken,
    currentContext: AssistantRequestContext,
  ): boolean {
    return (
      token.kind === "image_analysis" &&
      token.contextFingerprint === currentContext.fingerprint &&
      this.#isOperationStateCurrent(token)
    );
  }

  #isOperationStateCurrent(token: AssistantOperationToken): boolean {
    if (
      token.generation !== this.#generation ||
      token.mode !== this.#mode ||
      token.laneGeneration !== (token.kind === "chat" ? this.#chatGeneration : this.#imageVersion)
    ) {
      return false;
    }
    if (!token.dependsOnImage) {
      return token.imageId === null && token.imageVersion === null;
    }
    return token.imageId === this.#image?.id && token.imageVersion === this.#image.version;
  }

  isGenerationCurrent(token: AssistantOperationToken): boolean {
    return token.generation === this.#generation;
  }

  isImagePickerTokenCurrent(generation: number, imageVersion: number): boolean {
    return generation === this.#generation && imageVersion === this.#imageVersion;
  }

  #appendChat(message: StoredAssistantChatMessage): void {
    this.#chatMessages.push(message);
    if (this.#chatMessages.length > CHAT_LIMIT) {
      this.#chatMessages.splice(0, this.#chatMessages.length - CHAT_LIMIT);
    }
  }

  #markImageUnanalyzed(): void {
    if (this.#image !== null && this.#image.analysisStatus !== "unanalyzed") {
      this.#image = { ...this.#image, analysisStatus: "unanalyzed" };
    }
  }
}

function captureRequestContext(context: AssistantRequestContext): AssistantRequestContext {
  const transcript = Object.freeze({ ...context.transcript });
  const labels = Object.freeze(context.labels.map((label) => Object.freeze({ ...label })));
  return Object.freeze({
    ...context,
    transcript,
    labels,
  });
}
