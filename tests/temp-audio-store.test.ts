import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { extractPcm16FromWav } from "../src/audio/audio-contract";
import {
  TEMP_AUDIO_FILE_MODE,
  TempAudioStore,
  type TempAudioWriteOptions,
  withTemporaryWav,
} from "../src/audio/temp-audio-store";

const tempRoots: string[] = [];

async function createStore(): Promise<TempAudioStore> {
  const root = await mkdtemp(path.join(os.tmpdir(), "new-home-audio-test-"));
  tempRoots.push(root);
  return new TempAudioStore(root);
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("temporary audio cleanup", () => {
  it("deletes the temporary WAV after successful transcription", async () => {
    const store = await createStore();
    const pcm = new Uint8Array([0, 0, 1, 0]);
    let capturedPath = "";
    const result = await withTemporaryWav(store, pcm, async (filePath) => {
      capturedPath = filePath;
      expect(extractPcm16FromWav(new Uint8Array(await readFile(filePath)))).toEqual(pcm);
      return "transcript";
    });
    expect(result).toBe("transcript");
    await expect(readFile(capturedPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(store.activeCount).toBe(0);
  });

  it("requests owner-only permissions for every temporary microphone WAV", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "new-home-audio-test-"));
    tempRoots.push(root);
    let writeOptions: TempAudioWriteOptions | undefined;
    const store = new TempAudioStore(root, {
      createId: () => "private-capture",
      write: async (filePath, data, options) => {
        writeOptions = options;
        await writeFile(filePath, data, options);
      },
    });

    const filePath = await store.createWav(new Uint8Array([0, 0]));

    expect(writeOptions).toEqual({ mode: TEMP_AUDIO_FILE_MODE });
    await store.remove(filePath);
  });

  it("deletes the temporary WAV after transcription errors", async () => {
    const store = await createStore();
    let capturedPath = "";
    await expect(
      withTemporaryWav(store, new Uint8Array([0, 0]), async (filePath) => {
        capturedPath = filePath;
        throw new Error("ASR failed");
      }),
    ).rejects.toThrow("ASR failed");
    await expect(readFile(capturedPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(store.activeCount).toBe(0);
  });

  it("removes all tracked captures during reset cleanup", async () => {
    const store = await createStore();
    const first = await store.createWav(new Uint8Array([0, 0]));
    const second = await store.createWav(new Uint8Array([1, 0]));
    expect(store.activeCount).toBe(2);
    await store.cleanupAll();
    await expect(readFile(first)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(second)).rejects.toMatchObject({ code: "ENOENT" });
    expect(store.activeCount).toBe(0);
  });

  it("tracks before writing and removes a partial file when the write fails", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "new-home-audio-test-"));
    tempRoots.push(root);
    let partialPath = "";
    const store = new TempAudioStore(root, {
      createId: () => "partial-write",
      write: async (filePath, data) => {
        partialPath = filePath;
        await writeFile(filePath, data.subarray(0, 12));
        throw new Error("simulated partial write");
      },
    });

    await expect(store.createWav(new Uint8Array([0, 0]))).rejects.toThrow("simulated partial write");
    expect(store.activeCount).toBe(0);
    await expect(readFile(partialPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("retains an EPERM path for a later reset cleanup retry", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "new-home-audio-test-"));
    tempRoots.push(root);
    let removeCalls = 0;
    const store = new TempAudioStore(root, {
      createId: () => "retry-unlink",
      remove: async (filePath) => {
        removeCalls += 1;
        if (removeCalls === 1) {
          throw Object.assign(new Error("file is busy"), { code: "EPERM" });
        }
        await unlink(filePath);
      },
    });
    const filePath = await store.createWav(new Uint8Array([0, 0]));
    expect(store.activeCount).toBe(1);

    await expect(store.remove(filePath)).rejects.toMatchObject({ code: "EPERM" });
    expect(store.activeCount).toBe(1);
    expect((await readFile(filePath)).byteLength).toBeGreaterThan(0);

    await store.cleanupAll();
    expect(store.activeCount).toBe(0);
    expect(removeCalls).toBe(2);
    await expect(readFile(filePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps a partial write tracked when immediate cleanup fails", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "new-home-audio-test-"));
    tempRoots.push(root);
    let removeCalls = 0;
    const store = new TempAudioStore(root, {
      createId: () => "partial-retry",
      write: async (filePath, data) => {
        await writeFile(filePath, data.subarray(0, 8));
        throw new Error("partial write failed");
      },
      remove: async (filePath) => {
        removeCalls += 1;
        if (removeCalls === 1) {
          throw Object.assign(new Error("file is busy"), { code: "EBUSY" });
        }
        await unlink(filePath);
      },
    });

    await expect(store.createWav(new Uint8Array([0, 0]))).rejects.toBeInstanceOf(AggregateError);
    expect(store.activeCount).toBe(1);
    await store.cleanupAll();
    expect(store.activeCount).toBe(0);
    expect(removeCalls).toBe(2);
  });

  it("treats ENOENT as successful cleanup and updates activeCount", async () => {
    const store = await createStore();
    const filePath = await store.createWav(new Uint8Array([0, 0]));
    expect(store.activeCount).toBe(1);
    await unlink(filePath);

    await store.remove(filePath);

    expect(store.activeCount).toBe(0);
  });

  it("purges only owned capture WAVs when a new store starts", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "new-home-audio-test-"));
    tempRoots.push(root);
    const orphan = path.join(root, "capture-orphan.wav");
    const unrelatedWav = path.join(root, "meeting.wav");
    const similarName = path.join(root, "capture-not-a-wav.txt");
    await Promise.all([
      writeFile(orphan, new Uint8Array([1])),
      writeFile(unrelatedWav, new Uint8Array([2])),
      writeFile(similarName, new Uint8Array([3])),
    ]);

    const store = new TempAudioStore(root);
    const report = await store.recoverOwnedCaptures();

    expect(report).toEqual({ discovered: 1, removed: 1, retained: 0 });
    await expect(readFile(orphan)).rejects.toMatchObject({ code: "ENOENT" });
    expect([...(await readFile(unrelatedWav))]).toEqual([2]);
    expect([...(await readFile(similarName))]).toEqual([3]);
    expect(store.activeCount).toBe(0);
  });

  it("retains a locked startup orphan and retries it during later cleanup", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "new-home-audio-test-"));
    tempRoots.push(root);
    const orphan = path.join(root, "capture-locked.wav");
    await writeFile(orphan, new Uint8Array([1]));
    let removeCalls = 0;
    const store = new TempAudioStore(root, {
      remove: async (filePath) => {
        removeCalls += 1;
        if (removeCalls === 1) {
          throw Object.assign(new Error("file is locked"), { code: "EBUSY" });
        }
        await unlink(filePath);
      },
    });

    const report = await store.recoverOwnedCaptures();

    expect(report).toEqual({ discovered: 1, removed: 0, retained: 1 });
    expect(store.activeCount).toBe(1);
    expect([...(await readFile(orphan))]).toEqual([1]);

    await store.cleanupAll();
    expect(removeCalls).toBe(2);
    expect(store.activeCount).toBe(0);
    await expect(readFile(orphan)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects capture IDs that could escape the owned temp directory", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "new-home-audio-test-"));
    tempRoots.push(root);
    let writeCalled = false;
    const store = new TempAudioStore(root, {
      createId: () => "segment/../../../escaped",
      write: async () => {
        writeCalled = true;
      },
    });

    await expect(store.createWav(new Uint8Array([0, 0]))).rejects.toThrow("path-safe token");
    expect(writeCalled).toBe(false);
    expect(store.activeCount).toBe(0);
  });
});
