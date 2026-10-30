import { glob, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("local inference boundary", () => {
  it("contains no cloud inference endpoint or embedded web-service startup", async () => {
    const files: string[] = [];
    for await (const file of glob("src/**/*.ts")) {
      files.push(file);
    }
    const source = (await Promise.all(files.map(async (file) => readFile(path.resolve(file), "utf8")))).join(
      "\n",
    );
    expect(source).not.toMatch(/https?:\/\/(?:api\.)?openai\.com/i);
    expect(source).not.toMatch(/azure\.com\/openai/i);
    expect(source).not.toContain(".startWebService(");
    expect(source).not.toMatch(/\bfetch\s*\(/);
  });
});
