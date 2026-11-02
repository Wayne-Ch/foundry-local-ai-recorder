import { randomUUID } from "node:crypto";
import type { AssistantOperationKind } from "./assistant-types";

export const DEFAULT_MAX_ASSISTANT_QUEUE = 3;

export class AssistantCancelledError extends Error {
  constructor(message = "The assistant request was cancelled.") {
    super(message);
    this.name = "AssistantCancelledError";
  }
}

interface QueueTask<T> {
  readonly id: string;
  readonly ownerSessionId: string;
  readonly kind: AssistantOperationKind;
  readonly generation: number;
  readonly run: (signal: AbortSignal) => Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
  readonly abortController: AbortController;
}

export class AssistantOperationQueue {
  readonly #maxQueuedRequests: number;
  readonly #pending: QueueTask<unknown>[] = [];
  #active: QueueTask<unknown> | null = null;
  #generation = 0;

  constructor(maxQueuedRequests = DEFAULT_MAX_ASSISTANT_QUEUE) {
    if (!Number.isInteger(maxQueuedRequests) || maxQueuedRequests < 1) {
      throw new Error("Assistant queue capacity must be a positive integer.");
    }
    this.#maxQueuedRequests = maxQueuedRequests;
  }

  get activeRequestId(): string | null {
    return this.#active?.id ?? null;
  }

  get activeOperation(): AssistantOperationKind | null {
    return this.#active?.kind ?? null;
  }

  get queuedRequests(): number {
    return this.#pending.length;
  }

  get maxQueuedRequests(): number {
    return this.#maxQueuedRequests;
  }

  enqueue<T>(
    ownerSessionId: string,
    kind: AssistantOperationKind,
    run: (signal: AbortSignal) => Promise<T>,
  ): { readonly requestId: string; readonly result: Promise<T> } {
    if (this.#pending.length >= this.#maxQueuedRequests) {
      throw new Error(`The assistant queue is full (${this.#maxQueuedRequests} waiting requests).`);
    }
    const requestId = randomUUID();
    const generation = this.#generation;
    let resolveTask = (_value: T) => {};
    let rejectTask = (_error: unknown) => {};
    const result = new Promise<T>((resolve, reject) => {
      resolveTask = resolve;
      rejectTask = reject;
    });
    const task: QueueTask<T> = {
      id: requestId,
      ownerSessionId,
      kind,
      generation,
      run,
      resolve: resolveTask,
      reject: rejectTask,
      abortController: new AbortController(),
    };
    this.#pending.push(task as QueueTask<unknown>);
    void this.#drain();
    return { requestId, result };
  }

  cancel(requestId: string): boolean {
    if (this.#active?.id === requestId) {
      this.#active.abortController.abort();
      return true;
    }
    const index = this.#pending.findIndex((task) => task.id === requestId);
    if (index < 0) {
      return false;
    }
    const [task] = this.#pending.splice(index, 1);
    task?.abortController.abort();
    task?.reject(new AssistantCancelledError());
    return true;
  }

  cancelOwner(ownerSessionId: string): void {
    if (this.#active?.ownerSessionId === ownerSessionId) {
      this.#active.abortController.abort();
    }
    for (let index = this.#pending.length - 1; index >= 0; index -= 1) {
      const task = this.#pending[index];
      if (task?.ownerSessionId !== ownerSessionId) {
        continue;
      }
      this.#pending.splice(index, 1);
      task.abortController.abort();
      task.reject(new AssistantCancelledError("The renderer session ended."));
    }
  }

  reset(): void {
    this.#generation += 1;
    this.#active?.abortController.abort();
    for (const task of this.#pending.splice(0)) {
      task.abortController.abort();
      task.reject(new AssistantCancelledError("The assistant state was reset."));
    }
  }

  async #drain(): Promise<void> {
    if (this.#active !== null) {
      return;
    }
    const next = this.#pending.shift();
    if (next === undefined) {
      return;
    }
    this.#active = next;
    try {
      if (next.generation !== this.#generation || next.abortController.signal.aborted) {
        throw new AssistantCancelledError();
      }
      const value = await next.run(next.abortController.signal);
      if (next.generation !== this.#generation || next.abortController.signal.aborted) {
        throw new AssistantCancelledError();
      }
      next.resolve(value);
    } catch (error) {
      next.reject(
        next.abortController.signal.aborted && !(error instanceof AssistantCancelledError)
          ? new AssistantCancelledError()
          : error,
      );
    } finally {
      if (this.#active === next) {
        this.#active = null;
      }
      queueMicrotask(() => void this.#drain());
    }
  }
}
