import { execFileSync } from "node:child_process";

/** A failure in a known upstream transport or response that may use a prior snapshot. */
export class UpstreamRefreshError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "UpstreamRefreshError";
  }
}

const CURL_REMOTE_EXIT_CODES = new Set([
  5, // proxy name resolution
  6, // host name resolution
  7, // connect failure
  18, // partial transfer
  22, // HTTP error with --fail
  28, // timeout
  35, // TLS handshake
  47, // redirect loop
  51, // certificate verification
  52, // empty server reply
  55, // failed send
  56, // failed receive
  60, // peer certificate verification
]);

function childExitCode(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

/** Only classify documented curl network/HTTP exits; missing binaries and local exits stay fatal. */
function isCurlRemoteFailure(error: unknown): boolean {
  const status = childExitCode(error);
  return status !== undefined && CURL_REMOTE_EXIT_CODES.has(status);
}

export function fetchRemoteFile(
  url: string,
  output: string,
  timeoutSeconds: number,
  maxRetries = 2,
): void {
  try {
    execFileSync(
      "curl",
      ["-fsSL", "-m", String(timeoutSeconds), "--retry", String(maxRetries), url, "-o", output],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
  } catch (error) {
    if (isCurlRemoteFailure(error))
      throw new UpstreamRefreshError(`Remote fetch failed for ${url}`, { cause: error });
    throw error;
  }
}

export function fetchRemoteText(
  url: string,
  timeoutSeconds: number,
  maxBuffer: number,
  maxRetries = 2,
): string {
  try {
    return execFileSync(
      "curl",
      ["-fsSL", "-m", String(timeoutSeconds), "--retry", String(maxRetries), url],
      { encoding: "utf-8", maxBuffer },
    );
  } catch (error) {
    if (isCurlRemoteFailure(error))
      throw new UpstreamRefreshError(`Remote fetch failed for ${url}`, { cause: error });
    throw error;
  }
}

export function parseRemoteJson(value: string, label: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw new UpstreamRefreshError(`${label} returned invalid JSON`, { cause: error });
  }
}

export function upstreamResponseFailure(message: string, cause?: unknown): UpstreamRefreshError {
  return new UpstreamRefreshError(message, { cause });
}

export function isUpstreamRefreshError(error: unknown): error is UpstreamRefreshError {
  return error instanceof UpstreamRefreshError;
}
