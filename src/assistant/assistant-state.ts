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

export class AssistantMemoryState {
  #generation = 0;
  #chatGeneration = 0;
  #mode: AssistantMode = "classroom";
  #imageVersion = 0;
  #analysisVersion = 0;
  #image: AssistantLaneSnapshot["image"] = null;
  #imageAnalysis: ImageAnalysisSnapshot | null = null;
  readonly #chatMessages: AssistantChatMessage[] = [];
  readonly #trace: AssistantTraceEntry[] = [];

  snapshot(
    queue?: Pick<
      AssistantOperationQueue,
      "activeRequestId" | "activeOperation" | "queuedRequests" | "maxQueuedRequests"
    >,
  ): AssistantLaneSnapshot {
    return {
      generation: this.#generation,
      mode: this.#mode,
      image: this.#image,
      imageAnalysis: this.#imageAnalysis,
      chatMessages: [...this.#chatMessages],
      activeRequestId: queue?.activeRequestId ?? null,
      activeOperation: queue?.activeOperation ?? null,
      queuedRequests: queue?.queuedRequests ?? 0,
      maxQueuedRequests: queue?.maxQueuedRequests ?? DEFAULT_MAX_ASSISTANT_QUEUE,
      trace: [...this.#trace],
    };
  }

  setMode(mode: AssistantMode): void {
    if (mode !== this.#mode) {
      this.#generation += 1;
    }
    this.#mode = mode;
  }

  selectImage(input: ImageSelectionInput): AssistantLaneSnapshot["image"] {
    this.#imageVersion += 1;
    this.#image = {
      id: randomUUID(),
      version: this.#imageVersion,
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

  beginOperation(
    requestId: string,
    kind: AssistantOperationKind,
    context: AssistantRequestContext,
  ): AssistantOperationToken {
    return {
      requestId,
      generation: this.#generation,
      laneGeneration: kind === "chat" ? this.#chatGeneration : this.#imageVersion,
      kind,
      imageVersion: this.#image?.version ?? null,
      contextFingerprint: context.fingerprint,
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
      token.generation !== this.#generation ||
      token.laneGeneration !== this.#imageVersion ||
      token.imageVersion === null ||
      token.imageVersion !== this.#image?.version ||
      token.contextFingerprint !== currentContext.fingerprint
    ) {
      return false;
    }
    this.#analysisVersion += 1;
    this.#imageAnalysis = {
      ...note,
      version: this.#analysisVersion,
      imageVersion: token.imageVersion,
      contextLabels: durableChatMessageContext(currentContext),
      contextFingerprint: currentContext.fingerprint,
      mode: this.#mode,
      modelId,
      generatedAt: new Date().toISOString(),
    };
    return true;
  }

  appendUserMessage(
    requestId: string,
    question: string,
    context: AssistantRequestContext,
  ): AssistantChatMessage {
    const message: AssistantChatMessage = {
      id: randomUUID(),
      requestId,
      role: "user",
      text: question.trim(),
      contextLabels: durableChatMessageContext(context),
      createdAt: new Date().toISOString(),
    };
    this.#appendChat(message);
    return message;
  }

  applyChatAnswer(token: AssistantOperationToken, answer: string, context: AssistantRequestContext): boolean {
    if (
      token.kind !== "chat" ||
      token.generation !== this.#generation ||
      token.laneGeneration !== this.#chatGeneration ||
      token.imageVersion !== (this.#image?.version ?? null) ||
      token.contextFingerprint !== context.fingerprint
    ) {
      return false;
    }
    this.#appendChat({
      id: randomUUID(),
      requestId: token.requestId,
      role: "assistant",
      text: answer,
      contextLabels: durableChatMessageContext(context),
      createdAt: new Date().toISOString(),
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

  get chatMessages(): readonly AssistantChatMessage[] {
    return [...this.#chatMessages];
  }

  #appendChat(message: AssistantChatMessage): void {
    this.#chatMessages.push(message);
    if (this.#chatMessages.length > CHAT_LIMIT) {
      this.#chatMessages.splice(0, this.#chatMessages.length - CHAT_LIMIT);
    }
  }
}
