import { describe, expect, it, vi } from "vitest";
import {
  type AssistantSessionOwnerIdentity,
  AssistantSessionOwnership,
} from "../src/main/assistant-session-owner";

describe("AssistantSessionOwnership", () => {
  it("reuses the current frame session and rejects stale renderer generations", () => {
    const revoke = vi.fn();
    const ownership = new AssistantSessionOwnership(revoke);
    const original = owner();
    const first = ownership.open(original);

    expect(ownership.open(original)).toBe(first);
    const replacement = ownership.open(owner({ frameToken: "replacement" }));

    expect(revoke).toHaveBeenCalledWith(first.sessionId);
    expect(() => ownership.assertOwned(original, first.sessionId)).toThrow("stale renderer");
    expect(ownership.canRoute(replacement.owner, replacement.sessionId)).toBe(true);
  });

  it("cancels the exact owner on reload, navigation, render loss, or window close", () => {
    const revoke = vi.fn();
    const ownership = new AssistantSessionOwnership(revoke);
    const current = ownership.open(owner());

    ownership.revokeOwner(current.owner.webContentsId, {
      frameTreeNodeId: current.owner.frameTreeNodeId,
      frameToken: current.owner.frameToken,
    });

    expect(revoke).toHaveBeenCalledWith(current.sessionId);
    expect(ownership.canRoute(current.owner, current.sessionId)).toBe(false);
  });

  it("does not revoke a replacement frame when an old frame event arrives late", () => {
    const revoke = vi.fn();
    const ownership = new AssistantSessionOwnership(revoke);
    const old = ownership.open(owner());
    const replacement = ownership.open(owner({ frameToken: "replacement" }));
    revoke.mockClear();

    ownership.revokeOwner(old.owner.webContentsId, {
      frameTreeNodeId: old.owner.frameTreeNodeId,
      frameToken: old.owner.frameToken,
    });

    expect(revoke).not.toHaveBeenCalled();
    expect(ownership.canRoute(replacement.owner, replacement.sessionId)).toBe(true);
  });
});

function owner(overrides: Partial<AssistantSessionOwnerIdentity> = {}): AssistantSessionOwnerIdentity {
  return {
    webContentsId: 1,
    processId: 2,
    frameId: 3,
    frameTreeNodeId: 4,
    frameToken: "frame",
    ...overrides,
  };
}
