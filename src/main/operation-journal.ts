import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { resolveRecorderPaths } from "../foundry/paths";
import type { ModelRole, RuntimeTarget } from "../foundry/runtime-config";
import type { SafeDiagnostic } from "../shared/safe-diagnostic";

export type RecorderOperationJournalEvent =
  | {
      readonly at: string;
      readonly correlationId: string;
      readonly generation: number;
      readonly operation: "prepare";
      readonly status: "start";
      readonly enableLiveCaptions: boolean;
    }
  | {
      readonly at: string;
      readonly correlationId: string;
      readonly generation: number;
      readonly operation: "prepare";
      readonly status: "progress";
      readonly phase: string;
      readonly modelRole?: ModelRole;
      readonly modelSource?: RuntimeTarget["source"];
      readonly modelId?: string;
      readonly modelRef?: string;
      readonly cached?: boolean;
      readonly loaded?: boolean;
    }
  | {
      readonly at: string;
      readonly correlationId: string;
      readonly generation: number;
      readonly operation: "prepare";
      readonly status: "complete" | "fail" | "cancel";
      readonly elapsedMs: number;
      readonly diagnostic?: Pick<SafeDiagnostic, "code" | "name" | "context">;
    }
  | {
      readonly at: string;
      readonly correlationId: string;
      readonly generation: number;
      readonly operation: "reset" | "shutdown";
      readonly status: "start" | "complete" | "fail";
      readonly elapsedMs?: number;
      readonly diagnostic?: Pick<SafeDiagnostic, "code" | "name" | "context">;
    };

export interface RecorderOperationJournal {
  record(event: RecorderOperationJournalEvent): void;
  flush(): Promise<void>;
}

export const noopRecorderOperationJournal: RecorderOperationJournal = {
  record: () => {},
  flush: async () => {},
};

export function createRecorderOperationJournal(): RecorderOperationJournal {
  let tail = Promise.resolve();
  const filePath = resolveRecorderPaths().then(async ({ logsDir }) => {
    await mkdir(logsDir, { recursive: true });
    return path.join(logsDir, `ai-recorder-operations-${new Date().toISOString().slice(0, 10)}.jsonl`);
  });
  return {
    record(event) {
      tail = tail
        .then(async () => {
          await appendFile(await filePath, `${JSON.stringify(event)}\n`, "utf8");
        })
        .catch(() => undefined);
    },
    async flush() {
      await tail;
    },
  };
}
