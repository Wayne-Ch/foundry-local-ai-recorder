import { describe, expect, it } from "vitest";
import { appendLiveChunkWithBackpressure } from "../scripts/integration-utils";

describe("integration live-audio backpressure", () => {
  it("retries bounded native queue pressure before accepting the chunk", async () => {
    let attempts = 0;
    const result = await appendLiveChunkWithBackpressure(
      () => {
        attempts += 1;
        if (attempts < 3) {
          throw new Error("Audio stream backpressure capacity was exceeded.");
        }
        return { acceptedSequence: 4, totalBytes: 16_000 };
      },
      { maxWaitMs: 100, retryDelayMs: 0 },
    );

    expect(attempts).toBe(3);
    expect(result).toEqual({ acceptedSequence: 4, totalBytes: 16_000 });
  });

  it("does not retry unrelated stream failures", async () => {
    let attempts = 0;
    await expect(
      appendLiveChunkWithBackpressure(
        () => {
          attempts += 1;
          throw new Error("The native live audio stream failed.");
        },
        { maxWaitMs: 100, retryDelayMs: 0 },
      ),
    ).rejects.toThrow("native live audio stream failed");
    expect(attempts).toBe(1);
  });

  it("preserves the capacity failure after the bounded wait expires", async () => {
    await expect(
      appendLiveChunkWithBackpressure(
        () => {
          throw new Error("Audio stream backpressure capacity was exceeded.");
        },
        { maxWaitMs: 0, retryDelayMs: 0 },
      ),
    ).rejects.toThrow("backpressure capacity");
  });
});
