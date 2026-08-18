import { describe, expect, test } from "bun:test";
import { asText, withTimeout } from "../extensions/shared/tools.ts";

describe("asText", () => {
  test("builds a text-only tool result with details", () => {
    const result = asText("hello", { count: 1 });
    expect(result.content).toEqual([{ type: "text", text: "hello" }]);
    expect(result.details).toEqual({ count: 1 });
  });

  test("details payload passes through untouched", () => {
    const payload = { url: "https://x", status: 200 };
    expect(asText("body", payload).details).toBe(payload);
  });
});

describe("withTimeout", () => {
  test("returns a live signal before either trigger", () => {
    const handle = withTimeout(undefined, 10_000);
    expect(handle.signal.aborted).toBe(false);
    expect(handle.timedOut).toBe(false);
    handle.cleanup();
  });

  test("fires timedOut after the timeout elapses", async () => {
    const handle = withTimeout(undefined, 10);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(handle.signal.aborted).toBe(true);
    expect(handle.timedOut).toBe(true);
    handle.cleanup();
  });

  test("propagates an upstream abort without marking timedOut", async () => {
    const controller = new AbortController();
    const handle = withTimeout(controller.signal, 10_000);
    controller.abort();
    expect(handle.signal.aborted).toBe(true);
    expect(handle.timedOut).toBe(false);
    handle.cleanup();
  });

  test("honors an already-aborted signal immediately", () => {
    const controller = new AbortController();
    controller.abort();
    const handle = withTimeout(controller.signal, 10_000);
    expect(handle.signal.aborted).toBe(true);
    handle.cleanup();
  });

  test("cleanup releases the timer and listener", async () => {
    const controller = new AbortController();
    const handle = withTimeout(controller.signal, 5);
    handle.cleanup();
    await new Promise((resolve) => setTimeout(resolve, 20));
    // After cleanup the timer must not have fired: signal stays live.
    expect(handle.signal.aborted).toBe(false);
    expect(handle.timedOut).toBe(false);
  });
});
