import { describe, expect, it, vi } from "vitest";
import { ModelSlot } from "../src/foundry/model-slot";

class FakeModel {
  loaded: boolean;
  readonly isLoaded = vi.fn(async () => this.loaded);
  readonly load = vi.fn(async () => {
    this.loaded = true;
  });
  readonly unload = vi.fn(async () => {
    this.loaded = false;
  });

  constructor(
    readonly id: string,
    loaded: boolean,
  ) {
    this.loaded = loaded;
  }
}

describe("ModelSlot", () => {
  it("keeps the working model active when a replacement fails to load", async () => {
    const slot = new ModelSlot<FakeModel>();
    const owner = {};
    const working = new FakeModel("working", true);
    await slot.activate(working, owner);
    const failing = new FakeModel("failing", false);
    failing.load.mockRejectedValueOnce(new Error("load failed"));

    await expect(slot.activate(failing, owner)).rejects.toThrow("load failed");
    expect(slot.active).toBe(working);
    expect(working.unload).not.toHaveBeenCalled();
  });

  it("loads the replacement before unloading the previous model", async () => {
    const order: string[] = [];
    const slot = new ModelSlot<FakeModel>();
    const owner = {};
    const working = new FakeModel("working", true);
    working.unload.mockImplementation(async () => {
      order.push("old-unload");
      working.loaded = false;
    });
    await slot.activate(working, owner);
    const next = new FakeModel("next", false);
    next.load.mockImplementation(async () => {
      order.push("new-load");
      next.loaded = true;
    });

    await slot.activate(next, owner);
    expect(order).toEqual(["new-load", "old-unload"]);
    expect(slot.active).toBe(next);
  });

  it("retains the active model for retry after a failing loaded-state probe", async () => {
    const slot = new ModelSlot<FakeModel>();
    const model = new FakeModel("working", true);
    await slot.activate(model, {});
    model.isLoaded.mockRejectedValueOnce(new Error("loaded probe failed"));

    await expect(slot.clear()).rejects.toThrow("loaded probe failed");

    expect(slot.active).toBe(model);
    expect(model.unload).not.toHaveBeenCalled();
    await slot.clear();
    expect(slot.active).toBeNull();
    expect(model.unload).toHaveBeenCalledOnce();
  });

  it("retains the active model for retry after a failing unload", async () => {
    const slot = new ModelSlot<FakeModel>();
    const model = new FakeModel("working", true);
    await slot.activate(model, {});
    model.unload.mockRejectedValueOnce(new Error("unload failed"));

    await expect(slot.clear()).rejects.toThrow("unload failed");

    expect(slot.active).toBe(model);
    await slot.clear();
    expect(slot.active).toBeNull();
    expect(model.unload).toHaveBeenCalledTimes(2);
  });

  it("forces a stale model through unload, load, and validation for a new owner", async () => {
    const slot = new ModelSlot<FakeModel>();
    const firstOwner = {};
    const secondOwner = {};
    const model = new FakeModel("shared", true);
    await slot.activate(model, firstOwner);
    await slot.clear();
    model.loaded = true;
    model.unload.mockRejectedValueOnce(new Error("stale unload failed"));

    await expect(slot.activate(model, secondOwner)).rejects.toThrow("stale unload failed");
    expect(slot.activeFor(secondOwner)).toBeNull();
    expect(model.load).toHaveBeenCalledTimes(0);

    await slot.activate(model, secondOwner);

    expect(model.unload).toHaveBeenCalledTimes(3);
    expect(model.load).toHaveBeenCalledOnce();
    expect(model.isLoaded).toHaveBeenCalled();
    expect(slot.activeFor(firstOwner)).toBeNull();
    expect(slot.activeFor(secondOwner)).toBe(model);
  });
});
