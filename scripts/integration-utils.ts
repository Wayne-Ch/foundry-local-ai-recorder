import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { extractPcm16FromWav } from "../src/audio/audio-contract";
import { AUDIO_STREAM_CHUNK_BYTES } from "../src/audio/audio-types";
import { resolveRecorderPaths } from "../src/foundry/paths";

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
