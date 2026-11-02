import { randomUUID } from "node:crypto";

export interface AssistantSessionOwnerIdentity {
  readonly webContentsId: number;
  readonly processId: number;
  readonly frameId: number;
  readonly frameTreeNodeId: number;
  readonly frameToken: string;
}

export interface AssistantSessionLease {
  readonly sessionId: string;
  readonly owner: AssistantSessionOwnerIdentity;
}

export class AssistantSessionOwnership {
  #active: AssistantSessionLease | null = null;
  readonly #onRevoke: (sessionId: string) => void;

  constructor(onRevoke: (sessionId: string) => void) {
    this.#onRevoke = onRevoke;
  }

  open(owner: AssistantSessionOwnerIdentity): AssistantSessionLease {
    const active = this.#active;
    if (active !== null && sameOwner(active.owner, owner)) {
      return active;
    }
    if (active !== null) {
      this.#active = null;
      this.#onRevoke(active.sessionId);
    }
    const lease = { sessionId: randomUUID(), owner };
    this.#active = lease;
    return lease;
  }

  assertOwned(owner: AssistantSessionOwnerIdentity, sessionId: string): void {
    if (!this.canRoute(owner, sessionId)) {
      throw new Error("The assistant request belongs to a stale renderer session.");
    }
  }

  canRoute(owner: AssistantSessionOwnerIdentity, sessionId: string): boolean {
    const active = this.#active;
    return active !== null && active.sessionId === sessionId && sameOwner(active.owner, owner);
  }

  activeFor(owner: AssistantSessionOwnerIdentity): AssistantSessionLease | null {
    const active = this.#active;
    return active !== null && sameOwner(active.owner, owner) ? active : null;
  }

  revokeOwner(
    webContentsId: number,
    frame?: Pick<AssistantSessionOwnerIdentity, "frameTreeNodeId" | "frameToken">,
  ): void {
    const active = this.#active;
    if (
      active === null ||
      active.owner.webContentsId !== webContentsId ||
      (frame !== undefined &&
        (active.owner.frameTreeNodeId !== frame.frameTreeNodeId ||
          active.owner.frameToken !== frame.frameToken))
    ) {
      return;
    }
    this.#active = null;
    this.#onRevoke(active.sessionId);
  }
}

function sameOwner(left: AssistantSessionOwnerIdentity, right: AssistantSessionOwnerIdentity): boolean {
  return (
    left.webContentsId === right.webContentsId &&
    left.processId === right.processId &&
    left.frameId === right.frameId &&
    left.frameTreeNodeId === right.frameTreeNodeId &&
    left.frameToken === right.frameToken
  );
}
