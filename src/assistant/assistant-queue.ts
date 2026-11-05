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
  status: "queued" | "active";
  resultSettled: boolean;
  executionSettled: boolean;
}

export class AssistantOperationQueue {
  readonly #maxQueuedRequests: number;
  readonly #pending: QueueTask<unknown>[] = [];
  readonly #tasks = new Map<string, QueueTask<unknown>>();
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
    return [...this.#tasks.values()].some(
      (task) => task.status === "active" && task.abortController.signal.aborted && !task.executionSettled,
    );
  }

  get queuedRequests(): number {
    return this.#pending.filter((task) => !task.abortController.signal.aborted).length;
  }

  get maxQueuedRequests(): number {
    return this.#maxQueuedRequests;
  }

  enqueue<T>(
    ownerSessionId: string,
    token: AssistantOperationToken,
    run: (signal: AbortSignal, token: AssistantOperationToken) => Promise<T>,
  ): { readonly requestId: string; readonly result: Promise<T> } {
    if (this.queuedRequests >= this.#maxQueuedRequests) {
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
      status: "queued",
      resultSettled: false,
      executionSettled: false,
    };
    this.#pending.push(task as QueueTask<unknown>);
    this.#tasks.set(task.id, task as QueueTask<unknown>);
    let execution: Promise<T>;
    try {
      execution = Promise.resolve(task.run(task.abortController.signal, task.token));
    } catch (error) {
      execution = Promise.reject(error);
    }
    void this.#settle(task, execution);
    return { requestId, result };
  }

  markActive(requestId: string): boolean {
    const task = this.#tasks.get(requestId);
    if (task === undefined || task.abortController.signal.aborted || task.executionSettled) {
      return false;
    }
    const index = this.#pending.indexOf(task);
    if (index >= 0) {
      this.#pending.splice(index, 1);
    }
    task.status = "active";
    this.#active = task;
    return true;
  }

  cancel(requestId: string): boolean {
    const task = this.#tasks.get(requestId);
    return task === undefined ? false : this.#cancelTask(task, new AssistantCancelledError());
  }

  cancelOwner(ownerSessionId: string): void {
    for (const task of this.#tasks.values()) {
      if (task.ownerSessionId === ownerSessionId) {
        this.#cancelTask(task, new AssistantCancelledError("The renderer session ended."));
      }
    }
  }

  cancelKind(kind: AssistantOperationKind): boolean {
    let cancelled = false;
    for (const task of this.#tasks.values()) {
      if (task.token.kind === kind) {
        cancelled = this.#cancelTask(task, new AssistantCancelledError()) || cancelled;
      }
    }
    return cancelled;
  }

  cancelImageDependent(): boolean {
    let cancelled = false;
    for (const task of this.#tasks.values()) {
      if (task.token.dependsOnImage) {
        cancelled =
          this.#cancelTask(
            task,
            new AssistantCancelledError("The selected image or lesson context changed."),
          ) || cancelled;
      }
    }
    return cancelled;
  }

  cancelAll(message = "The assistant request was cancelled."): void {
    this.#generation += 1;
    for (const task of this.#tasks.values()) {
      this.#cancelTask(task, new AssistantCancelledError(message));
    }
  }

  reset(): void {
    this.cancelAll("The assistant state was reset.");
  }

  async #settle<T>(task: QueueTask<T>, execution: Promise<T>): Promise<void> {
    try {
      if (task.generation !== this.#generation || task.abortController.signal.aborted) {
        throw new AssistantCancelledError();
      }
      const value = await execution;
      if (task.generation !== this.#generation || task.abortController.signal.aborted) {
        throw new AssistantCancelledError();
      }
      this.#resolveTask(task, value);
    } catch (error) {
      this.#rejectTask(
        task,
        task.abortController.signal.aborted &&
          !(error instanceof AssistantCancelledError) &&
          !(error instanceof AggregateError)
          ? new AssistantCancelledError()
          : error,
      );
    } finally {
      task.executionSettled = true;
      const index = this.#pending.indexOf(task as QueueTask<unknown>);
      if (index >= 0) {
        this.#pending.splice(index, 1);
      }
      if (this.#active === task) {
        this.#active = null;
      }
      this.#tasks.delete(task.id);
    }
  }

  #cancelTask(task: QueueTask<unknown>, error: AssistantCancelledError): boolean {
    if (task.abortController.signal.aborted || task.executionSettled) {
      return false;
    }
    task.abortController.abort(error);
    if (task.status === "queued") {
      const index = this.#pending.indexOf(task);
      if (index >= 0) {
        this.#pending.splice(index, 1);
      }
      this.#rejectTask(task, error);
    }
    return true;
  }

  #resolveTask<T>(task: QueueTask<T>, value: T): void {
    if (task.resultSettled) {
      return;
    }
    task.resultSettled = true;
    task.resolve(value);
  }

  #rejectTask<T>(task: QueueTask<T>, error: unknown): void {
    if (task.resultSettled) {
      return;
    }
    task.resultSettled = true;
    task.reject(error);
  }
}
