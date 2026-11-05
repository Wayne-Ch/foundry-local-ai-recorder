import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import electronPath from "electron";
import {
  assistantInferenceImageDimensions,
  type PreparedAssistantInferenceImage,
  prepareAssistantInferenceImage,
} from "../src/assistant/image-inference";
import type { ValidatedImage } from "../src/assistant/image-security";

const execFileAsync = promisify(execFile);
const electronExecutablePath = String(electronPath);
const transcoderPath = fileURLToPath(new URL("./electron-image-transcoder", import.meta.url));

export async function prepareFixtureInferenceImage(
  filePath: string,
  image: ValidatedImage,
): Promise<PreparedAssistantInferenceImage> {
  const target = assistantInferenceImageDimensions(image.width, image.height);
  const { stdout, stderr } = await execFileAsync(
    electronExecutablePath,
    [transcoderPath, filePath, String(target.width), String(target.height)],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 30_000,
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  const resultLine = stdout.split(/\r?\n/u).find((line) => line.startsWith("IMAGE_TRANSCODE_OK "));
  if (resultLine === undefined) {
    throw new Error(`Hidden image preprocessing failed: ${stderr || stdout}`);
  }
  const result = parseTranscodeResult(resultLine.slice("IMAGE_TRANSCODE_OK ".length));
  const encoded = Uint8Array.from(Buffer.from(result.pngBase64, "base64"));
  return prepareAssistantInferenceImage(image, (_source, expectedTarget) => {
    if (expectedTarget.width !== target.width || expectedTarget.height !== target.height) {
      throw new Error("The integration image target changed after preprocessing.");
    }
    return {
      decodedWidth: result.decodedWidth,
      decodedHeight: result.decodedHeight,
      width: result.width,
      height: result.height,
      bytes: encoded,
    };
  });
}

function parseTranscodeResult(value: string): {
  readonly decodedWidth: number;
  readonly decodedHeight: number;
  readonly width: number;
  readonly height: number;
  readonly pngBase64: string;
} {
  const candidate: unknown = JSON.parse(value);
  if (
    typeof candidate !== "object" ||
    candidate === null ||
    !("decodedWidth" in candidate) ||
    !("decodedHeight" in candidate) ||
    !("width" in candidate) ||
    !("height" in candidate) ||
    !("pngBase64" in candidate) ||
    typeof candidate.decodedWidth !== "number" ||
    typeof candidate.decodedHeight !== "number" ||
    typeof candidate.width !== "number" ||
    typeof candidate.height !== "number" ||
    typeof candidate.pngBase64 !== "string"
  ) {
    throw new Error("The hidden image preprocessor returned an invalid result.");
  }
  return {
    decodedWidth: candidate.decodedWidth,
    decodedHeight: candidate.decodedHeight,
    width: candidate.width,
    height: candidate.height,
    pngBase64: candidate.pngBase64,
  };
}
