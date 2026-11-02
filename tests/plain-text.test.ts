import { describe, expect, it } from "vitest";
import { formatAssistantPlainText } from "../src/assistant/plain-text";

describe("assistant safe display", () => {
  it("keeps markup inert as plain text and removes control characters", () => {
    expect(formatAssistantPlainText("<img src=x onerror=alert(1)>\u0000 ODE")).toBe(
      "<img src=x onerror=alert(1)> ODE",
    );
  });

  it("rejects empty and unbounded output", () => {
    expect(() => formatAssistantPlainText("\u0000")).toThrow("no displayable text");
    expect(() => formatAssistantPlainText("x".repeat(4_001))).toThrow("display bound");
  });
});
