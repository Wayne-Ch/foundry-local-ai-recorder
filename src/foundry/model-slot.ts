export interface LoadableModel {
  readonly id: string;
  isLoaded(): Promise<boolean>;
  load(): Promise<void>;
  unload(): Promise<void>;
}

export class ModelSlot<T extends LoadableModel> {
  #active: { readonly model: T; readonly owner: object } | null = null;
  readonly #owners = new WeakMap<T, object>();

  get active(): T | null {
    return this.#active?.model ?? null;
  }

  activeFor(owner: object): T | null {
    return this.#active?.owner === owner ? this.#active.model : null;
  }

  async activate(candidate: T, owner: object): Promise<T> {
    const current = this.#active;
    if (current?.model === candidate && current.owner === owner && (await candidate.isLoaded())) {
      return candidate;
    }

    const previousOwner = this.#owners.get(candidate);
    if (previousOwner !== undefined && previousOwner !== owner) {
      if (current?.model === candidate) {
        this.#active = null;
      }
      if (await candidate.isLoaded()) {
        await candidate.unload();
      }
      await candidate.load();
    } else if (!(await candidate.isLoaded())) {
      await candidate.load();
    }
    if (!(await candidate.isLoaded())) {
      throw new Error(`Model ${candidate.id} did not report loaded after activation.`);
    }

    if (current !== null && current.model !== candidate && (await current.model.isLoaded())) {
      await current.model.unload();
    }
    this.#active = { model: candidate, owner };
    this.#owners.set(candidate, owner);
    return candidate;
  }

  async clear(): Promise<void> {
    const current = this.#active;
    if (current !== null && (await current.model.isLoaded())) {
      await current.model.unload();
    }
    if (this.#active === current) {
      this.#active = null;
    }
  }
}
