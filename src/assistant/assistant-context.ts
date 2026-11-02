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
  const transcriptContext = transcript.finalText
    ? {
        kind: "final_transcript" as const,
        text: transcript.finalText,
        version: transcript.version,
        liveSequence: null,
        ephemeral: false,
      }
    : transcript.liveDraft
      ? {
          kind: "live_draft" as const,
          text: transcript.liveDraft,
          version: null,
          liveSequence: transcript.liveSequence,
          ephemeral: true,
        }
      : {
          kind: "none" as const,
          text: "",
          version: null,
          liveSequence: null,
          ephemeral: false,
        };
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
    summaryText: summary?.text ?? null,
    summaryVersion: summary?.transcriptVersion ?? null,
    imageAnalysisText: imageAnalysis === null ? null : formatImageAnalysisContext(imageAnalysis),
    imageAnalysisVersion: imageAnalysis?.version ?? null,
    labels,
    fingerprint: [
      transcriptContext.kind,
      transcriptContext.version ?? "-",
      transcriptContext.liveSequence ?? "-",
      summary?.transcriptVersion ?? "-",
      imageAnalysis?.version ?? "-",
    ].join(":"),
  };
}

export function buildImageAnalysisContext(transcript: TranscriptSnapshot): AssistantRequestContext {
  const context = buildAssistantContext(transcript, null);
  const labels = context.labels.filter(
    (label) => label.kind === "live_draft" || label.kind === "final_transcript" || label.kind === "none",
  );
  return {
    ...context,
    summaryText: null,
    summaryVersion: null,
    labels,
    fingerprint: [
      context.transcript.kind,
      context.transcript.version ?? "-",
      context.transcript.liveSequence ?? "-",
    ].join(":"),
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
