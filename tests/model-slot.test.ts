import { describe, expect, it, vi } from "vitest";
import { ModelSlot } from "../src/foundry/model-slot";

class FakeModel {
  loaded: boolean;
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

  async isLoaded(): Promise<boolean> {
    return this.loaded;
  }
}

describe("ModelSlot", () => {
  it("keeps the working model active when a replacement fails to load", async () => {
    const slot = new ModelSlot<FakeModel>();
    const working = new FakeModel("working", true);
    await slot.activate(working);
    const failing = new FakeModel("failing", false);
    failing.load.mockRejectedValueOnce(new Error("load failed"));

    await expect(slot.activate(failing)).rejects.toThrow("load failed");
    expect(slot.active).toBe(working);
    expect(working.unload).not.toHaveBeenCalled();
  });

  it("loads the replacement before unloading the previous model", async () => {
    const order: string[] = [];
    const slot = new ModelSlot<FakeModel>();
    const working = new FakeModel("working", true);
    working.unload.mockImplementation(async () => {
      order.push("old-unload");
      working.loaded = false;
    });
    await slot.activate(working);
    const next = new FakeModel("next", false);
    next.load.mockImplementation(async () => {
      order.push("new-load");
      next.loaded = true;
    });

    await slot.activate(next);
    expect(order).toEqual(["new-load", "old-unload"]);
    expect(slot.active).toBe(next);
  });
});
