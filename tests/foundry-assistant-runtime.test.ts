import type { EpDownloadResult, EpInfo, FoundryLocalConfig } from "foundry-local-sdk";
import { DeviceType } from "foundry-local-sdk";
import { describe, expect, it, vi } from "vitest";
import {
  FoundryAssistantRuntime,
  type FoundryAssistantRuntimeOptions,
} from "../src/foundry/foundry-assistant-runtime";
import type {
  OptionalVisionChatRuntimeStatus,
  PreparedVisionChatModel,
  VisionChatTurnResult,
} from "../src/foundry/optional-vision-chat-runtime";

describe("FoundryAssistantRuntime", () => {
  it("uses a separate guarded in-process manager and exact compatible target", async () => {
    const manager = new FakeManager();
    const vision = new FakeVisionRuntime();
    let managerConfig: FoundryLocalConfig | null = null;
    const runtime = createRuntime({
      createManager: (config) => {
        managerConfig = config;
        return manager;
      },
      createVisionRuntime: (_catalog, target) => {
        expect(target).toMatchObject({
          modelId: "qwen3.5-0.8b-generic-gpu:2",
          deviceType: DeviceType.GPU,
          executionProvider: "WebGPUExecutionProvider",
        });
        return vision;
      },
    });

    await runtime.runTurn({ prompt: "What is ODE?" });

    expect(managerConfig).toMatchObject({
      appName: "FoundryLocalSmartAIRecorderAssistant",
      disableNonessentialTelemetry: true,
    });
    expect(vision.prepare).toHaveBeenCalledOnce();
    expect(vision.runTurn).toHaveBeenCalledOnce();
    await runtime.dispose();
    expect(vision.dispose).toHaveBeenCalledOnce();
    expect(manager.shutdown).toHaveBeenCalledOnce();
    expect(manager.dispose).toHaveBeenCalledOnce();
  });

  it("rejects and disposes a manager that exposes an endpoint", async () => {
    const manager = new FakeManager();
    manager.urls = ["http://127.0.0.1:5272"];
    const createVisionRuntime = vi.fn(() => new FakeVisionRuntime());
    const runtime = createRuntime({
      createManager: () => manager,
      createVisionRuntime,
    });

    await expect(runtime.prepare()).rejects.toThrow("endpoint guard");
    expect(createVisionRuntime).not.toHaveBeenCalled();
    expect(manager.shutdown).toHaveBeenCalledOnce();
    expect(manager.dispose).toHaveBeenCalledOnce();
  });

  it("registers the exact execution provider before preparing the optional model", async () => {
    const manager = new FakeManager();
    manager.providers = [
      {
        name: "WebGpuExecutionProvider",
        isRegistered: false,
      },
    ];
    const runtime = createRuntime({ createManager: () => manager });

    await runtime.prepare();

    expect(manager.downloadAndRegisterEps).toHaveBeenCalledWith(
      ["WebGpuExecutionProvider"],
      expect.any(Function),
    );
    await runtime.dispose();
  });

  it("fails closed and tears down only the optional manager if an endpoint appears later", async () => {
    const manager = new FakeManager();
    const vision = new FakeVisionRuntime();
    const runtime = createRuntime({
      createManager: () => manager,
      createVisionRuntime: () => vision,
    });
    await runtime.prepare();
    manager.isWebServiceRunning = true;

    await expect(runtime.prepare()).rejects.toThrow("endpoint guard");

    expect(vision.dispose).toHaveBeenCalledOnce();
    expect(manager.shutdown).toHaveBeenCalledOnce();
    expect(manager.dispose).toHaveBeenCalledOnce();
  });
});

class FakeManager {
  readonly catalog = { getModelVariant: vi.fn() };
  urls: string[] = [];
  isWebServiceRunning = false;
  providers: EpInfo[] = [
    {
      name: "WebGPUExecutionProvider",
      isRegistered: true,
    },
  ];
  readonly shutdown = vi.fn();
  readonly dispose = vi.fn();
  readonly downloadAndRegisterEps = vi.fn(
    async (): Promise<EpDownloadResult> => ({
      success: true,
      status: "registered",
      registeredEps: ["WebGPUExecutionProvider"],
      failedEps: [],
    }),
  );

  discoverEps(): EpInfo[] {
    return this.providers;
  }
}

class FakeVisionRuntime {
  readonly status: OptionalVisionChatRuntimeStatus = {
    state: "ready",
    model: preparedModel(),
    turnActive: false,
  };
  readonly prepare = vi.fn(async (): Promise<PreparedVisionChatModel> => preparedModel());
  readonly runTurn = vi.fn(
    async (): Promise<VisionChatTurnResult> => ({
      text: "An ODE is an equation involving a function and its ordinary derivatives.",
      model: preparedModel(),
      preflight: {
        promptTokens: 10,
        outputReserveTokens: 10,
        requiredTokens: 20,
        contextLimitTokens: 4096,
        fits: true,
        deficitTokens: 0,
      },
      response: {
        output: [{ type: "text", text: "answer" }],
        finishReason: "stop",
        usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
      },
    }),
  );
  readonly cancelActiveTurn = vi.fn(() => true);
  readonly dispose = vi.fn(async (): Promise<void> => {});
}

function createRuntime(overrides: FoundryAssistantRuntimeOptions = {}): FoundryAssistantRuntime {
  return new FoundryAssistantRuntime({
    environment: {},
    resolvePaths: async () => ({
      appDataDir: "C:\\app",
      modelCacheDir: "C:\\models",
      logsDir: "C:\\logs",
      audioTempDir: "C:\\audio",
    }),
    createManager: () => new FakeManager(),
    createVisionRuntime: () => new FakeVisionRuntime(),
    ...overrides,
  });
}

function preparedModel(): PreparedVisionChatModel {
  return {
    modelId: "qwen3.5-0.8b-generic-gpu:2",
    source: "primary",
    task: "vision-language-chat",
    runtime: {
      deviceType: DeviceType.GPU,
      executionProvider: "WebGPUExecutionProvider",
    },
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
  };
}
