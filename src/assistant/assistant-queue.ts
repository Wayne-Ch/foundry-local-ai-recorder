import type {
  AssistantOperationKind,
  AssistantOperationToken,
  AssistantPendingOperation,
} from "./assistant-types";

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
  readonly token: AssistantOperationToken;
  readonly generation: number;
  readonly run: (signal: AbortSignal, token: AssistantOperationToken) => Promise<T>;
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
    const active = this.#active;
    return active !== null && !active.abortController.signal.aborted ? active.id : null;
  }

  get activeOperation(): AssistantOperationKind | null {
    const active = this.#active;
    return active !== null && !active.abortController.signal.aborted ? active.token.kind : null;
  }

  get pendingOperations(): readonly AssistantPendingOperation[] {
    const active =
      this.#active !== null && !this.#active.abortController.signal.aborted
        ? [
            {
              requestId: this.#active.id,
              kind: this.#active.token.kind,
              status: "active" as const,
              phase: "initializing_runtime" as const,
            },
          ]
        : [];
    return [
      ...active,
      ...this.#pending
        .filter((task) => !task.abortController.signal.aborted)
        .map((task) => ({
          requestId: task.id,
          kind: task.token.kind,
          status: "queued" as const,
          phase: "queued" as const,
        })),
    ];
  }

  get draining(): boolean {
    return this.#active?.abortController.signal.aborted === true;
  }

  get queuedRequests(): number {
    return this.#pending.length;
  }

  get maxQueuedRequests(): number {
    return this.#maxQueuedRequests;
  }

  enqueue<T>(
    ownerSessionId: string,
    token: AssistantOperationToken,
    run: (signal: AbortSignal, token: AssistantOperationToken) => Promise<T>,
  ): { readonly requestId: string; readonly result: Promise<T> } {
    if (this.draining) {
      throw new Error("Optional assistant cleanup is still draining.");
    }
    if (this.#pending.length >= this.#maxQueuedRequests) {
      throw new Error(`The assistant queue is full (${this.#maxQueuedRequests} waiting requests).`);
    }
    const requestId = token.requestId;
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
      token,
      generation,
      run,
      resolve: resolveTask,
      reject: rejectTask,
      abortController: new AbortController(),
    };
    this.#pending.push(task as QueueTask<unknown>);
    queueMicrotask(() => void this.#drain());
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

  cancelKind(kind: AssistantOperationKind): boolean {
    let cancelled = false;
    if (this.#active?.token.kind === kind) {
      this.#active.abortController.abort();
      cancelled = true;
    }
    for (let index = this.#pending.length - 1; index >= 0; index -= 1) {
      const task = this.#pending[index];
      if (task?.token.kind !== kind) {
        continue;
      }
      this.#pending.splice(index, 1);
      task.abortController.abort();
      task.reject(new AssistantCancelledError());
      cancelled = true;
    }
    return cancelled;
  }

  cancelImageDependent(): boolean {
    let cancelled = false;
    if (this.#active?.token.dependsOnImage === true) {
      this.#active.abortController.abort();
      cancelled = true;
    }
    for (let index = this.#pending.length - 1; index >= 0; index -= 1) {
      const task = this.#pending[index];
      if (task?.token.dependsOnImage !== true) {
        continue;
      }
      this.#pending.splice(index, 1);
      task.abortController.abort();
      task.reject(new AssistantCancelledError("The selected image or lesson context changed."));
      cancelled = true;
    }
    return cancelled;
  }

  cancelAll(message = "The assistant request was cancelled."): void {
    this.#generation += 1;
    this.#active?.abortController.abort();
    for (const task of this.#pending.splice(0)) {
      task.abortController.abort();
      task.reject(new AssistantCancelledError(message));
    }
  }

  reset(): void {
    this.cancelAll("The assistant state was reset.");
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
      const value = await next.run(next.abortController.signal, next.token);
      if (next.generation !== this.#generation || next.abortController.signal.aborted) {
        throw new AssistantCancelledError();
      }
      next.resolve(value);
    } catch (error) {
      next.reject(
        next.abortController.signal.aborted &&
          !(error instanceof AssistantCancelledError) &&
          !(error instanceof AggregateError)
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
