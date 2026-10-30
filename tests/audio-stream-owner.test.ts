import { describe, expect, it, vi } from "vitest";
import { type AudioStreamOwnerIdentity, AudioStreamOwnership } from "../src/main/audio-stream-owner";

const ownerA: AudioStreamOwnerIdentity = {
  webContentsId: 1,
  processId: 10,
  frameId: 100,
  frameTreeNodeId: 1000,
  frameToken: "frame-a",
};
const ownerB: AudioStreamOwnerIdentity = {
  webContentsId: 2,
  processId: 20,
  frameId: 200,
  frameTreeNodeId: 2000,
  frameToken: "frame-b",
};

describe("main-process audio stream ownership", () => {
  it("cancels the active stream when its owning frame is destroyed or navigated", async () => {
    const cancelStream = vi.fn(async () => {});
    const ownership = new AudioStreamOwnership(cancelStream);
    const lease = ownership.begin(ownerA);

    expect(await ownership.activate(lease, "stream-a")).toBe(true);
    await ownership.revokeOwner(ownerA.webContentsId, ownerA);

    expect(cancelStream).toHaveBeenCalledOnce();
    expect(cancelStream).toHaveBeenCalledWith("stream-a");
    expect(ownership.canRoute(lease, "stream-a")).toBe(false);
  });

  it("cancels a stream that starts after its renderer was already replaced", async () => {
    const cancelStream = vi.fn(async () => {});
    const ownership = new AudioStreamOwnership(cancelStream);
    const lease = ownership.begin(ownerA);

    await ownership.revokeOwner(ownerA.webContentsId);

    await expect(ownership.activate(lease, "late-stream")).resolves.toBe(false);
    expect(cancelStream).toHaveBeenCalledWith("late-stream");
  });

  it("never routes an old partial or stream command to a new renderer owner", async () => {
    const ownership = new AudioStreamOwnership(async () => {});
    const oldLease = ownership.begin(ownerA);
    await ownership.activate(oldLease, "stream-a");
    await ownership.revokeOwner(ownerA.webContentsId);

    const newLease = ownership.begin(ownerB);
    expect(ownership.canRoute(oldLease, "stream-a")).toBe(false);
    expect(() => ownership.assertOwned(ownerB, "stream-a")).toThrow("renderer frame that started");
    expect(newLease.sessionId).toBeGreaterThan(oldLease.sessionId);
    expect(ownership.canRoute(newLease, "stream-b")).toBe(true);
    await expect(ownership.activate(newLease, "stream-b")).resolves.toBe(true);
  });
});
