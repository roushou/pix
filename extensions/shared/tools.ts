/**
 * Shared tool plumbing — standard result construction and abort/timeout
 * handling for custom tools.
 *
 * Every custom tool returns an `AgentToolResult` (text content + details)
 * and must honor the caller's `AbortSignal`. `asText` is the standard
 * one-liner result builder; `withTimeout` composes the caller's signal with
 * a hard timeout so long-running work (fetches, subprocesses) fails loudly
 * instead of hanging the turn. Both were previously private to web.ts and
 * are used by the tools in this package; keeping them here means the
 * abort-handling contract is written once and tested (tests/tools.test.ts).
 */

import type { AgentToolResult } from "@earendil-works/pi-agent-core";

/** Build a text-only tool result with the given details payload. */
export function asText<T>(text: string, details: T): AgentToolResult<T> {
  return { content: [{ type: "text", text }], details };
}

export interface TimeoutHandle {
  /** Abort signal that fires on the caller's abort or on timeout, whichever first. */
  signal: AbortSignal;
  /** True when the timeout fired (as opposed to an upstream abort). */
  timedOut: boolean;
  /** Release the timer and the listener. Call in `finally`. */
  cleanup: () => void;
}

/**
 * Wrap an `AbortSignal` with a hard timeout. The returned signal aborts when
 * either the caller aborts or `timeoutMs` elapses; `handle.timedOut`
 * distinguishes the two so callers can report "timed out after N ms" instead
 * of a generic abort. Safe with an absent signal.
 */
export function withTimeout(signal: AbortSignal | undefined, timeoutMs: number): TimeoutHandle {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  return {
    signal: controller.signal,
    get timedOut() {
      return timedOut;
    },
    cleanup: () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
    },
  };
}
