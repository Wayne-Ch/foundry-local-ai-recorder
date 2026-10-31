import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { extractPcm16FromWav } from "../src/audio/audio-contract";
import { AUDIO_STREAM_CHUNK_BYTES } from "../src/audio/audio-types";
import { resolveRecorderPaths } from "../src/foundry/paths";
import { formatSummaryForDisplay } from "../src/summary/summary-format";

export const fixturePath = path.resolve("fixtures", "ode-lesson.wav");
export const expectedWords = [
  "ordinary",
  "differential",
  "equation",
  "derivative",
  "solution",
  "initial",
] as const;

export async function loadFixturePcm(): Promise<Uint8Array> {
  return extractPcm16FromWav(await readFile(fixturePath));
}

export function chunks(pcm: Uint8Array): Uint8Array[] {
  const output: Uint8Array[] = [];
  for (let offset = 0; offset < pcm.byteLength; offset += AUDIO_STREAM_CHUNK_BYTES) {
    output.push(pcm.slice(offset, Math.min(offset + AUDIO_STREAM_CHUNK_BYTES, pcm.byteLength)));
  }
  return output;
}

export function keywordRecall(transcript: string): {
  readonly matched: readonly string[];
  readonly recall: number;
} {
  const normalized = transcript.toLowerCase();
  const matched = expectedWords.filter((word) => normalized.includes(word));
  return { matched, recall: matched.length / expectedWords.length };
}

export function assertSummaryDisplayText(text: string): void {
  assert.ok(text.length > 20, "Summary must be nonempty and substantive.");
  assert.ok(text.length <= 2_500, "Summary must remain bounded.");
  assert.equal(hasRawMathDollarDelimiter(text), false, `Summary retained a raw math $ delimiter: ${text}`);
  assert.equal(
    formatSummaryForDisplay(text).text,
    text,
    "Summary display text must be stable under a second formatting pass.",
  );
}

export async function listOwnedTempFiles(): Promise<readonly string[]> {
  const paths = await resolveRecorderPaths();
  try {
    return (await readdir(paths.audioTempDir)).filter((file) => /^capture-.+\.wav$/.test(file));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function hasRawMathDollarDelimiter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== "$") {
      continue;
    }
    const previous = value[index - 1];
    const next = value[index + 1];
    if (previous === "$" || next === "$") {
      return true;
    }
    if (next !== undefined && !/\d/.test(next) && /[\s\p{L}([{\\+\-−]/u.test(next)) {
      return true;
    }
    if (
      previous !== undefined &&
      /[\p{L}\d)}\]]/u.test(previous) &&
      (next === undefined || /[\s.,;:!?]/.test(next))
    ) {
      return true;
    }
  }
  return false;
}
