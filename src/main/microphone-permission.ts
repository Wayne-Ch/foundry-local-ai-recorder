export const MICROPHONE_AUTHORIZATION_TTL_MS = 2_000;

interface MicrophonePermissionGateOptions {
  readonly expectedWebContents: object;
  readonly expectedDocumentUrl: string;
  readonly expectedOrigin: string;
  readonly now?: () => number;
  readonly authorizationTtlMs?: number;
}

interface MicrophoneAuthorizationAttempt {
  readonly webContents: object | null;
  readonly frame: object | null;
  readonly mainFrame: object | null;
  readonly documentUrl: string;
  readonly frameUrl: string;
  readonly hasTransientUserActivation: boolean;
}

interface MicrophonePermissionBase {
  readonly webContents: object | null;
  readonly mainFrame: object | null;
  readonly currentDocumentUrl: string;
  readonly mainFrameUrl: string;
  readonly permission: string;
  readonly requestingUrl: string | undefined;
  readonly securityOrigin: string | undefined;
  readonly isMainFrame: boolean;
}

interface MicrophonePermissionCheck extends MicrophonePermissionBase {
  readonly requestingOrigin: string;
  readonly mediaType: string | undefined;
}

interface MicrophonePermissionRequest extends MicrophonePermissionBase {
  readonly mediaTypes: readonly string[] | undefined;
}

export class MicrophonePermissionGate {
  readonly #expectedWebContents: object;
  readonly #expectedDocumentUrl: string;
  readonly #expectedOrigin: string;
  readonly #now: () => number;
  readonly #authorizationTtlMs: number;
  #authorizedUntil = 0;
  #checkConsumed = false;

  constructor(options: MicrophonePermissionGateOptions) {
    this.#expectedWebContents = options.expectedWebContents;
    this.#expectedDocumentUrl = options.expectedDocumentUrl;
    this.#expectedOrigin = options.expectedOrigin;
    this.#now = options.now ?? Date.now;
    this.#authorizationTtlMs = options.authorizationTtlMs ?? MICROPHONE_AUTHORIZATION_TTL_MS;
  }

  authorize(attempt: MicrophoneAuthorizationAttempt): boolean {
    this.revoke();
    if (
      !attempt.hasTransientUserActivation ||
      attempt.webContents !== this.#expectedWebContents ||
      attempt.frame === null ||
      attempt.frame !== attempt.mainFrame ||
      attempt.documentUrl !== this.#expectedDocumentUrl ||
      attempt.frameUrl !== this.#expectedDocumentUrl
    ) {
      return false;
    }

    this.#authorizedUntil = this.#now() + this.#authorizationTtlMs;
    return true;
  }

  allowCheck(attempt: MicrophonePermissionCheck): boolean {
    return (
      this.#matchesBase(attempt) &&
      attempt.requestingOrigin === this.#expectedOrigin &&
      attempt.securityOrigin === this.#expectedOrigin &&
      attempt.mediaType === "audio" &&
      this.#consumeCheckAuthorization()
    );
  }

  allowRequest(attempt: MicrophonePermissionRequest): boolean {
    return (
      this.#matchesBase(attempt) &&
      attempt.securityOrigin === this.#expectedOrigin &&
      attempt.mediaTypes?.length === 1 &&
      attempt.mediaTypes[0] === "audio" &&
      this.#consumeRequestAuthorization()
    );
  }

  revoke(): void {
    this.#authorizedUntil = 0;
    this.#checkConsumed = false;
  }

  #matchesBase(attempt: MicrophonePermissionBase): boolean {
    return (
      attempt.permission === "media" &&
      attempt.webContents === this.#expectedWebContents &&
      attempt.mainFrame !== null &&
      attempt.currentDocumentUrl === this.#expectedDocumentUrl &&
      attempt.mainFrameUrl === this.#expectedDocumentUrl &&
      attempt.requestingUrl === this.#expectedDocumentUrl &&
      attempt.isMainFrame
    );
  }

  #consumeCheckAuthorization(): boolean {
    const authorized = this.#authorizedUntil > this.#now() && !this.#checkConsumed;
    if (authorized) {
      this.#checkConsumed = true;
    }
    return authorized;
  }

  #consumeRequestAuthorization(): boolean {
    const authorized = this.#authorizedUntil > this.#now();
    this.revoke();
    return authorized;
  }
}

export function permissionOriginForDocument(documentUrl: string): string {
  const parsed = new URL(documentUrl);
  if (parsed.protocol === "file:") {
    return parsed.host ? `file://${parsed.host}` : "file:///";
  }
  return parsed.origin;
}

export function isAllowedAppNavigation(
  expectedDocumentUrl: string,
  targetUrl: string,
  isMainFrame: boolean,
): boolean {
  return isMainFrame && targetUrl === expectedDocumentUrl;
}
