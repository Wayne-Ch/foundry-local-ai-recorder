export interface SummaryState {
  readonly text: string;
  readonly transcriptVersion: number;
  readonly generatedAt: string;
  readonly modelId: string;
  readonly durationMs: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
}

export interface TranscriptSnapshot {
  readonly liveDraft: string;
  readonly liveSequence: number;
  readonly liveStreamId: string | null;
  readonly finalText: string;
  readonly version: number;
  readonly submittedVersion: number | null;
  readonly summary: SummaryState | null;
}

export interface SubmittedTranscript {
  readonly text: string;
  readonly version: number;
}

export class TranscriptStore {
  #liveDraft = "";
  #liveSequence = -1;
  #liveStreamId: string | null = null;
  #finalText = "";
  #version = 0;
  #submittedVersion: number | null = null;
  #summary: SummaryState | null = null;

  get snapshot(): TranscriptSnapshot {
    return {
      liveDraft: this.#liveDraft,
      liveSequence: this.#liveSequence,
      liveStreamId: this.#liveStreamId,
      finalText: this.#finalText,
      version: this.#version,
      submittedVersion: this.#submittedVersion,
      summary: this.#summary,
    };
  }

  startLiveDraft(streamId: string): void {
    this.#liveStreamId = streamId;
    this.#liveSequence = -1;
    this.#liveDraft = "";
  }

  applyLivePartial(streamId: string, sequence: number, text: string): boolean {
    if (streamId !== this.#liveStreamId || sequence <= this.#liveSequence) {
      return false;
    }
    this.#liveSequence = sequence;
    this.#liveDraft = normalizeTranscript(text);
    return true;
  }

  clearLiveDraft(streamId?: string): void {
    if (streamId !== undefined && streamId !== this.#liveStreamId) {
      return;
    }
    this.#liveStreamId = null;
    this.#liveSequence = -1;
    this.#liveDraft = "";
  }

  setWhisperFinal(text: string): TranscriptSnapshot {
    const normalized = normalizeTranscript(text);
    if (!normalized) {
      throw new Error("The Whisper final transcript is empty.");
    }
    this.#finalText = normalized;
    this.#version += 1;
    this.#submittedVersion = null;
    this.#summary = null;
    this.clearLiveDraft();
    return this.snapshot;
  }

  editFinal(text: string): TranscriptSnapshot {
    const normalized = normalizeTranscript(text);
    if (!normalized) {
      throw new Error("The final transcript cannot be empty.");
    }
    if (normalized !== this.#finalText) {
      this.#finalText = normalized;
      this.#version += 1;
      this.#submittedVersion = null;
      this.#summary = null;
    }
    return this.snapshot;
  }

  submitForSummary(): SubmittedTranscript {
    if (!this.#finalText) {
      throw new Error("A Whisper final transcript is required before summary generation.");
    }
    this.#submittedVersion = this.#version;
    return { text: this.#finalText, version: this.#version };
  }

  applySummary(summary: SummaryState): TranscriptSnapshot {
    if (this.#submittedVersion !== summary.transcriptVersion || this.#version !== summary.transcriptVersion) {
      throw new Error("The transcript changed while the summary was being generated.");
    }
    this.#summary = summary;
    return this.snapshot;
  }

  reset(): TranscriptSnapshot {
    this.#liveDraft = "";
    this.#liveSequence = -1;
    this.#liveStreamId = null;
    this.#finalText = "";
    this.#version = 0;
    this.#submittedVersion = null;
    this.#summary = null;
    return this.snapshot;
  }
}

function normalizeTranscript(value: string): string {
  return value.trim().replaceAll(/\s+/g, " ");
}
