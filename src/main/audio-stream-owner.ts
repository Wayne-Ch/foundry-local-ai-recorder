export interface AudioStreamOwnerIdentity {
  readonly webContentsId: number;
  readonly processId: number;
  readonly frameId: number;
  readonly frameTreeNodeId: number;
  readonly frameToken: string;
}

export interface AudioStreamLease {
  readonly sessionId: number;
  readonly owner: AudioStreamOwnerIdentity;
}

interface MutableAudioStreamLease extends AudioStreamLease {
  streamId: string | null;
  revoked: boolean;
  cancellationPromise: Promise<void> | null;
}

export class AudioStreamOwnership {
  readonly #cancelStream: (streamId: string) => Promise<void>;
  #nextSessionId = 1;
  #current: MutableAudioStreamLease | null = null;

  constructor(cancelStream: (streamId: string) => Promise<void>) {
    this.#cancelStream = cancelStream;
  }

  begin(owner: AudioStreamOwnerIdentity): AudioStreamLease {
    if (this.#current !== null) {
      throw new Error("A renderer already owns the active audio stream.");
    }
    const lease: MutableAudioStreamLease = {
      sessionId: this.#nextSessionId,
      owner,
      streamId: null,
      revoked: false,
      cancellationPromise: null,
    };
    this.#nextSessionId += 1;
    this.#current = lease;
    return lease;
  }

  canRoute(lease: AudioStreamLease, streamId: string): boolean {
    const active = lease as MutableAudioStreamLease;
    if (this.#current !== active || active.revoked) {
      return false;
    }
    if (active.streamId === null) {
      active.streamId = streamId;
    }
    return active.streamId === streamId;
  }

  async activate(lease: AudioStreamLease, streamId: string): Promise<boolean> {
    const active = lease as MutableAudioStreamLease;
    if (active.streamId !== null && active.streamId !== streamId) {
      throw new Error("The audio stream ID changed while renderer ownership was being established.");
    }
    active.streamId = streamId;
    if (this.#current !== active || active.revoked) {
      await this.#cancel(active);
      return false;
    }
    return true;
  }

  assertOwned(owner: AudioStreamOwnerIdentity, streamId: string): void {
    const active = this.#current;
    if (
      active === null ||
      active.revoked ||
      active.streamId !== streamId ||
      !sameOwner(active.owner, owner)
    ) {
      throw new Error("Audio stream IPC is restricted to the renderer frame that started the stream.");
    }
  }

  async revokeOwner(
    webContentsId: number,
    frame?: Pick<AudioStreamOwnerIdentity, "frameTreeNodeId" | "frameToken">,
  ) {
    const active = this.#current;
    if (
      active === null ||
      active.owner.webContentsId !== webContentsId ||
      (frame !== undefined &&
        (active.owner.frameTreeNodeId !== frame.frameTreeNodeId ||
          active.owner.frameToken !== frame.frameToken))
    ) {
      return;
    }
    active.revoked = true;
    await this.#cancel(active);
  }

  complete(owner: AudioStreamOwnerIdentity, streamId: string): void {
    const active = this.#current;
    if (active !== null && sameOwner(active.owner, owner) && active.streamId === streamId) {
      this.#current = null;
    }
  }

  release(lease: AudioStreamLease): void {
    const active = lease as MutableAudioStreamLease;
    active.revoked = true;
    if (this.#current === active) {
      this.#current = null;
    }
  }

  async #cancel(active: MutableAudioStreamLease): Promise<void> {
    if (active.streamId === null) {
      return;
    }
    if (active.cancellationPromise === null) {
      active.cancellationPromise = this.#cancelStream(active.streamId).finally(() => {
        if (this.#current === active) {
          this.#current = null;
        }
      });
    }
    await active.cancellationPromise;
  }
}

function sameOwner(left: AudioStreamOwnerIdentity, right: AudioStreamOwnerIdentity): boolean {
  return (
    left.webContentsId === right.webContentsId &&
    left.processId === right.processId &&
    left.frameId === right.frameId &&
    left.frameTreeNodeId === right.frameTreeNodeId &&
    left.frameToken === right.frameToken
  );
}
