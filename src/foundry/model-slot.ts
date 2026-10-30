export interface LoadableModel {
  readonly id: string;
  isLoaded(): Promise<boolean>;
  load(): Promise<void>;
  unload(): Promise<void>;
}

export class ModelSlot<T extends LoadableModel> {
  #active: T | null = null;

  get active(): T | null {
    return this.#active;
  }

  async activate(candidate: T): Promise<T> {
    const current = this.#active;
    if (current === candidate && (await candidate.isLoaded())) {
      return candidate;
    }
    if (!(await candidate.isLoaded())) {
      await candidate.load();
    }
    this.#active = candidate;
    if (current !== null && current !== candidate && (await current.isLoaded())) {
      await current.unload();
    }
    return candidate;
  }

  async clear(): Promise<void> {
    const current = this.#active;
    if (current !== null && (await current.isLoaded())) {
      await current.unload();
    }
    if (this.#active === current) {
      this.#active = null;
    }
  }
}
