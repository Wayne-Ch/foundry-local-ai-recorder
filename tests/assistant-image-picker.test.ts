import { Buffer } from "node:buffer";
import { describe, expect, it, vi } from "vitest";
import type { AssistantLaneSnapshot } from "../src/assistant/assistant-types";
import type {
  AssistantImageByteLifecycle,
  AssistantImageBytePurpose,
} from "../src/assistant/image-byte-lifecycle";
import {
  type AssistantImagePickerDependencies,
  type AssistantImagePickerGuard,
  pickAssistantImage,
} from "../src/main/assistant-image-picker";

describe("assistant image picker ownership", () => {
  it("lets Reset win while the OS dialog remains open", async () => {
    const dialog = deferred<{ readonly canceled: boolean; readonly filePaths: readonly string[] }>();
    let current = true;
    const commit = vi.fn();
    const selection = pickAssistantImage(
      dependencies({ showDialog: () => dialog.promise }),
      guard(() => current, commit),
    );

    current = false;
    dialog.resolve({ canceled: false, filePaths: ["/tmp/lesson.png"] });

    await expect(selection).rejects.toThrow("stale");
    expect(commit).not.toHaveBeenCalled();
  });

  it("zeroes file bytes when Reset wins during a delayed read", async () => {
    const read = deferred<Uint8Array>();
    const fileBytes = pngHeader();
    let current = true;
    const commit = vi.fn();
    const selection = pickAssistantImage(
      dependencies({
        readFile: () => {
          read.markStarted();
          return read.promise;
        },
      }),
      guard(() => current, commit),
    );
    await vi.waitFor(() => expect(read.started).toBe(true));

    current = false;
    read.resolve(fileBytes);

    await expect(selection).rejects.toThrow("stale");
    expect(fileBytes.every((value) => value === 0)).toBe(true);
    expect(commit).not.toHaveBeenCalled();
  });

  it("zeroes file and validated copies when Reset wins during delayed decode/thumbnail", async () => {
    const thumbnail = deferred<string>();
    const fileBytes = Buffer.from(pngHeader());
    const lifecycle = new TrackingImageByteLifecycle();
    let validatedBytes: Uint8Array | null = null;
    let current = true;
    const commit = vi.fn();
    const selection = pickAssistantImage(
      dependencies({
        readFile: async () => fileBytes,
        createThumbnail: async (image) => {
          validatedBytes = image.bytes;
          thumbnail.markStarted();
          return thumbnail.promise;
        },
        imageByteLifecycle: lifecycle,
      }),
      guard(() => current, commit),
    );
    await vi.waitFor(() => expect(thumbnail.started).toBe(true));

    current = false;
    thumbnail.resolve("data:image/png;base64,abc");

    await expect(selection).rejects.toThrow("stale");
    expect(fileBytes.every((value) => value === 0)).toBe(true);
    expect(validatedBytes).not.toBeNull();
    expect((validatedBytes as unknown as Uint8Array).every((value) => value === 0)).toBe(true);
    expect(lifecycle.releases).toEqual([
      { bytes: fileBytes, purpose: "picker-file" },
      { bytes: validatedBytes, purpose: "validated-image" },
    ]);
    expect(new Set(lifecycle.releases.map((release) => release.bytes)).size).toBe(2);
    expect(commit).not.toHaveBeenCalled();
  });

  it("rejects a stale renderer owner after stat and before any read", async () => {
    const stat = deferred<{ readonly size: number }>();
    let ownerCurrent = true;
    const readFile = vi.fn(async () => pngHeader());
    const commit = vi.fn();
    const selection = pickAssistantImage(
      dependencies({
        stat: () => {
          stat.markStarted();
          return stat.promise;
        },
        readFile,
      }),
      guard(() => ownerCurrent, commit),
    );
    await vi.waitFor(() => expect(stat.started).toBe(true));

    ownerCurrent = false;
    stat.resolve({ size: 24 });

    await expect(selection).rejects.toThrow("stale");
    expect(readFile).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });
});

function dependencies(
  overrides: Partial<AssistantImagePickerDependencies> = {},
): AssistantImagePickerDependencies {
  return {
    showDialog: async () => ({ canceled: false, filePaths: ["/tmp/lesson.png"] }),
    stat: async () => ({ size: 24 }),
    readFile: async () => pngHeader(),
    createThumbnail: async () => "data:image/png;base64,abc",
    ...overrides,
  };
}

function guard(
  current: () => boolean,
  commit: (...args: Parameters<AssistantImagePickerGuard["commit"]>) => unknown,
) {
  return {
    assertCurrent: () => {
      if (!current()) {
        throw new Error("The image selection belongs to stale assistant state or owner.");
      }
    },
    commit: (...args: Parameters<AssistantImagePickerGuard["commit"]>) =>
      commit(...args) as unknown as AssistantLaneSnapshot,
  };
}

function pngHeader(): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  bytes.set([0, 0, 0, 1, 0, 0, 0, 1], 16);
  return bytes;
}

class TrackingImageByteLifecycle implements AssistantImageByteLifecycle {
  readonly releases: Array<{
    readonly bytes: Uint8Array;
    readonly purpose: AssistantImageBytePurpose;
  }> = [];

  copy(source: Uint8Array): Uint8Array {
    return Uint8Array.from(source);
  }

  release(bytes: Uint8Array, purpose: AssistantImageBytePurpose): void {
    this.releases.push({ bytes, purpose });
    bytes.fill(0);
  }
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly started: boolean;
  resolve(value: T): void;
  markStarted(): void;
} {
  let resolve = (_value: T) => {};
  let started = false;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return {
    promise,
    get started() {
      return started;
    },
    resolve,
    markStarted: () => {
      started = true;
    },
  };
}
