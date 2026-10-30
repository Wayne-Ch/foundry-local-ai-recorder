import type { RecorderApi } from "../shared/contracts";

declare global {
  interface Window {
    recorderApi: RecorderApi;
  }
}
