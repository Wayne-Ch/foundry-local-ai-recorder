import { describe, expect, it } from "vitest";
import {
  isAllowedAppNavigation,
  MicrophonePermissionGate,
  permissionOriginForDocument,
} from "../src/main/microphone-permission";

const documentUrl = "file:///C:/demo/dist/renderer/index.html";
const origin = "file:///";

function createGate() {
  const webContents = {};
  const mainFrame = {};
  let now = 1_000;
  const gate = new MicrophonePermissionGate({
    expectedWebContents: webContents,
    expectedDocumentUrl: documentUrl,
    expectedOrigin: origin,
    now: () => now,
    authorizationTtlMs: 100,
  });
  return {
    gate,
    webContents,
    mainFrame,
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
  };
}

function authorize(
  gate: MicrophonePermissionGate,
  webContents: object,
  mainFrame: object,
  overrides: Partial<Parameters<MicrophonePermissionGate["authorize"]>[0]> = {},
): boolean {
  return gate.authorize({
    webContents,
    frame: mainFrame,
    mainFrame,
    documentUrl,
    frameUrl: documentUrl,
    hasTransientUserActivation: true,
    ...overrides,
  });
}

describe("microphone permission authorization", () => {
  it("allows one exact main-frame audio check after a transient user action", () => {
    const { gate, webContents, mainFrame } = createGate();
    expect(authorize(gate, webContents, mainFrame)).toBe(true);

    const attempt = {
      webContents,
      mainFrame,
      currentDocumentUrl: documentUrl,
      mainFrameUrl: documentUrl,
      permission: "media",
      requestingOrigin: origin,
      requestingUrl: documentUrl,
      securityOrigin: origin,
      mediaType: "audio",
      isMainFrame: true,
    };
    expect(gate.allowCheck(attempt)).toBe(true);
    expect(gate.allowCheck(attempt)).toBe(false);
  });

  it("allows one exact audio-only main-frame permission request", () => {
    const { gate, webContents, mainFrame } = createGate();
    expect(authorize(gate, webContents, mainFrame)).toBe(true);

    const attempt = {
      webContents,
      mainFrame,
      currentDocumentUrl: documentUrl,
      mainFrameUrl: documentUrl,
      permission: "media",
      requestingUrl: documentUrl,
      securityOrigin: origin,
      mediaTypes: ["audio"],
      isMainFrame: true,
    };
    expect(gate.allowRequest(attempt)).toBe(true);
    expect(gate.allowRequest(attempt)).toBe(false);
  });

  it("allows Electron's exact check-then-request flow for file:/// once", () => {
    const { gate, webContents, mainFrame } = createGate();
    expect(authorize(gate, webContents, mainFrame)).toBe(true);

    expect(
      gate.allowCheck({
        webContents,
        mainFrame,
        currentDocumentUrl: documentUrl,
        mainFrameUrl: documentUrl,
        permission: "media",
        requestingOrigin: "file:///",
        requestingUrl: documentUrl,
        securityOrigin: "file:///",
        mediaType: "audio",
        isMainFrame: true,
      }),
    ).toBe(true);
    expect(
      gate.allowRequest({
        webContents,
        mainFrame,
        currentDocumentUrl: documentUrl,
        mainFrameUrl: documentUrl,
        permission: "media",
        requestingUrl: documentUrl,
        securityOrigin: "file:///",
        mediaTypes: ["audio"],
        isMainFrame: true,
      }),
    ).toBe(true);
  });

  it("fails closed for missing activation, stale authorization, wrong frames, origins, or media", () => {
    const { gate, webContents, mainFrame, advance } = createGate();
    expect(
      authorize(gate, webContents, mainFrame, {
        hasTransientUserActivation: false,
      }),
    ).toBe(false);
    expect(authorize(gate, {}, mainFrame)).toBe(false);
    expect(authorize(gate, webContents, mainFrame, { frame: {} })).toBe(false);
    expect(authorize(gate, webContents, mainFrame)).toBe(true);
    advance(101);

    expect(
      gate.allowRequest({
        webContents,
        mainFrame,
        currentDocumentUrl: documentUrl,
        mainFrameUrl: documentUrl,
        permission: "media",
        requestingUrl: documentUrl,
        securityOrigin: origin,
        mediaTypes: ["audio"],
        isMainFrame: true,
      }),
    ).toBe(false);

    expect(authorize(gate, webContents, mainFrame)).toBe(true);
    expect(
      gate.allowRequest({
        webContents,
        mainFrame,
        currentDocumentUrl: documentUrl,
        mainFrameUrl: documentUrl,
        permission: "media",
        requestingUrl: documentUrl,
        securityOrigin: "https://example.test",
        mediaTypes: ["audio", "video"],
        isMainFrame: false,
      }),
    ).toBe(false);
  });

  it("accepts only the expected local file origin and main-frame navigation", () => {
    expect(permissionOriginForDocument(documentUrl)).toBe(origin);
    expect(permissionOriginForDocument("file://server/share/index.html")).toBe("file://server");
    expect(permissionOriginForDocument("https://example.test/app")).toBe("https://example.test");
    expect(isAllowedAppNavigation(documentUrl, documentUrl, true)).toBe(true);
    expect(isAllowedAppNavigation(documentUrl, "https://example.test/", true)).toBe(false);
    expect(isAllowedAppNavigation(documentUrl, documentUrl, false)).toBe(false);
  });
});
