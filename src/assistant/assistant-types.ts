export type AssistantMode = "classroom" | "clinic";

export type AssistantOperationKind = "image_analysis" | "chat";

export type AssistantOperationPhase =
  | "queued"
  | "initializing_runtime"
  | "checking_catalog"
  | "checking_cache"
  | "downloading_model"
  | "checking_provider"
  | "registering_provider"
  | "loading_model"
  | "running_inference";

export interface AssistantPendingOperation {
  readonly requestId: string;
  readonly kind: AssistantOperationKind;
  readonly status: "active" | "queued";
  readonly phase: AssistantOperationPhase;
}

export type AssistantContextKind = "live_draft" | "final_transcript" | "summary" | "image_analysis" | "none";

export interface AssistantContextLabel {
  readonly kind: AssistantContextKind;
  readonly label: string;
  readonly version: number | null;
  readonly ephemeral: boolean;
}

export interface AssistantTranscriptContext {
  readonly kind: "live_draft" | "final_transcript" | "none";
  readonly text: string;
  readonly version: number | null;
  readonly liveSequence: number | null;
  readonly ephemeral: boolean;
}

export interface AssistantRequestContext {
  readonly transcript: AssistantTranscriptContext;
  readonly transcriptFingerprint: string;
  readonly summaryText: string | null;
  readonly summaryVersion: number | null;
  readonly imageAnalysisText: string | null;
  readonly imageAnalysisVersion: number | null;
  readonly labels: readonly AssistantContextLabel[];
  readonly fingerprint: string;
}

export interface AssistantImageSelection {
  readonly id: string;
  readonly version: number;
  readonly analysisStatus: "unanalyzed" | "ready";
  readonly basename: string;
  readonly mimeType: "image/png" | "image/jpeg" | "image/webp";
  readonly sizeBytes: number;
  readonly width: number;
  readonly height: number;
  readonly thumbnailDataUrl: string;
  readonly selectedAt: string;
}

export interface ImageAnalysisNote {
  readonly visibleTextAndObjects: string;
  readonly relationToLesson: string;
  readonly uncertainty: string;
}

export interface ImageAnalysisSnapshot extends ImageAnalysisNote {
  readonly version: number;
  readonly imageId: string;
  readonly imageVersion: number;
  readonly contextLabels: readonly AssistantContextLabel[];
  readonly contextFingerprint: string;
  readonly mode: AssistantMode;
  readonly modelId: string;
  readonly generatedAt: string;
}

export interface AssistantChatMessage {
  readonly id: string;
  readonly requestId: string;
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly mode: AssistantMode;
  readonly contextFingerprint: string;
  readonly dependsOnImage: boolean;
  readonly imageId: string | null;
  readonly imageVersion: number | null;
  readonly contextLabels: readonly AssistantContextLabel[];
  readonly createdAt: string;
}

export interface AssistantTraceEntry {
  readonly at: string;
  readonly phase: string;
  readonly detail: string;
  readonly severity: "info" | "warning" | "error";
  readonly requestId?: string;
}

export interface AssistantLaneSnapshot {
  readonly generation: number;
  readonly mode: AssistantMode;
  readonly image: AssistantImageSelection | null;
  readonly imageAnalysis: ImageAnalysisSnapshot | null;
  readonly chatMessages: readonly AssistantChatMessage[];
  readonly activeRequestId: string | null;
  readonly activeOperation: AssistantOperationKind | null;
  readonly pendingOperations: readonly AssistantPendingOperation[];
  readonly queuedRequests: number;
  readonly maxQueuedRequests: number;
  readonly cleanupPending: boolean;
  readonly cleanupDetail: string | null;
  readonly trace: readonly AssistantTraceEntry[];
}

export interface AssistantOperationToken {
  readonly requestId: string;
  readonly generation: number;
  readonly laneGeneration: number;
  readonly kind: AssistantOperationKind;
  readonly mode: AssistantMode;
  readonly dependsOnImage: boolean;
  readonly requiresImageBytes: boolean;
  readonly imageId: string | null;
  readonly imageVersion: number | null;
  readonly contextFingerprint: string;
  readonly context: AssistantRequestContext;
}
