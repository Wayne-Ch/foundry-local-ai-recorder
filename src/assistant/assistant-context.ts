import { createHash } from "node:crypto";
import type { TranscriptSnapshot } from "../transcript/transcript-store";
import type {
  AssistantContextLabel,
  AssistantRequestContext,
  ImageAnalysisSnapshot,
} from "./assistant-types";

export function buildAssistantContext(
  transcript: TranscriptSnapshot,
  imageAnalysis: ImageAnalysisSnapshot | null,
): AssistantRequestContext {
  const transcriptContext = resolveTranscriptContext(transcript);
  const transcriptFingerprint = fingerprint([
    transcriptContext.kind,
    transcriptContext.version,
    transcriptContext.liveSequence,
    transcriptContext.text,
  ]);
  const summary =
    transcript.summary !== null && transcript.summary.transcriptVersion === transcript.version
      ? transcript.summary
      : null;
  const labels: AssistantContextLabel[] = [];
  if (transcriptContext.kind === "final_transcript") {
    labels.push({
      kind: "final_transcript",
      label: `final transcript v${transcriptContext.version}`,
      version: transcriptContext.version,
      ephemeral: false,
    });
  } else if (transcriptContext.kind === "live_draft") {
    labels.push({
      kind: "live_draft",
      label: "live draft snapshot (may change)",
      version: null,
      ephemeral: true,
    });
  }
  if (summary !== null) {
    labels.push({
      kind: "summary",
      label: `summary v${summary.transcriptVersion}`,
      version: summary.transcriptVersion,
      ephemeral: false,
    });
  }
  if (imageAnalysis !== null) {
    labels.push({
      kind: "image_analysis",
      label: `image analysis v${imageAnalysis.version}`,
      version: imageAnalysis.version,
      ephemeral: false,
    });
  }
  if (labels.length === 0) {
    labels.push({ kind: "none", label: "none", version: null, ephemeral: false });
  }

  return {
    transcript: transcriptContext,
    transcriptFingerprint,
    summaryText: summary?.text ?? null,
    summaryVersion: summary?.transcriptVersion ?? null,
    imageAnalysisText: imageAnalysis === null ? null : formatImageAnalysisContext(imageAnalysis),
    imageAnalysisVersion: imageAnalysis?.version ?? null,
    labels,
    fingerprint: fingerprint([
      "assistant-context",
      transcriptFingerprint,
      summary?.transcriptVersion ?? null,
      summary?.text ?? null,
      imageAnalysis?.version ?? null,
      imageAnalysis?.imageId ?? null,
      imageAnalysis?.imageVersion ?? null,
      imageAnalysis?.mode ?? null,
      imageAnalysis?.contextFingerprint ?? null,
      imageAnalysis === null ? null : formatImageAnalysisContext(imageAnalysis),
    ]),
  };
}

export function buildImageAnalysisContext(transcript: TranscriptSnapshot): AssistantRequestContext {
  const transcriptContext = resolveTranscriptContext(transcript);
  const transcriptFingerprint = fingerprint([
    transcriptContext.kind,
    transcriptContext.version,
    transcriptContext.liveSequence,
    transcriptContext.text,
  ]);
  const labels: AssistantContextLabel[] =
    transcriptContext.kind === "final_transcript"
      ? [
          {
            kind: "final_transcript",
            label: `final transcript v${transcriptContext.version}`,
            version: transcriptContext.version,
            ephemeral: false,
          },
        ]
      : transcriptContext.kind === "live_draft"
        ? [
            {
              kind: "live_draft",
              label: "live draft snapshot (may change)",
              version: null,
              ephemeral: true,
            },
          ]
        : [{ kind: "none", label: "none", version: null, ephemeral: false }];
  return {
    transcript: transcriptContext,
    transcriptFingerprint,
    summaryText: null,
    summaryVersion: null,
    imageAnalysisText: null,
    imageAnalysisVersion: null,
    labels,
    fingerprint: fingerprint(["image-analysis-context", transcriptFingerprint]),
  };
}

export function durableChatMessageContext(
  context: AssistantRequestContext,
): readonly AssistantContextLabel[] {
  return context.labels.map((label) => ({ ...label }));
}

function formatImageAnalysisContext(analysis: ImageAnalysisSnapshot): string {
  return [
    `Visible text/objects: ${analysis.visibleTextAndObjects}`,
    `Relation: ${analysis.relationToLesson}`,
    `Uncertainty: ${analysis.uncertainty}`,
  ].join("\n");
}

function resolveTranscriptContext(transcript: TranscriptSnapshot): AssistantRequestContext["transcript"] {
  if (transcript.finalText) {
    return {
      kind: "final_transcript",
      text: transcript.finalText,
      version: transcript.version,
      liveSequence: null,
      ephemeral: false,
    };
  }
  if (transcript.liveDraft) {
    return {
      kind: "live_draft",
      text: transcript.liveDraft,
      version: null,
      liveSequence: transcript.liveSequence,
      ephemeral: true,
    };
  }
  return {
    kind: "none",
    text: "",
    version: null,
    liveSequence: null,
    ephemeral: false,
  };
}

function fingerprint(parts: readonly unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}
