/**
 * notify — desktop notification when the agent finishes its task.
 *
 * Fires on `agent_settled`, which is emitted once the agent will not continue
 * running on its own (no pending retries, compaction retries, or queued
 * follow-ups).
 *
 * Supported platforms:
 * - macOS: native notification via `osascript` (AppleScript)
 * - Linux: `notify-send` (libnotify) when available, otherwise terminal OSC
 *   escape sequences (OSC 99 for Kitty, OSC 777 for Ghostty/iTerm2/WezTerm/rxvt)
 * - Other: terminal OSC escape fallback
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const execFileAsync = promisify(execFile);

const TITLE = "pi";

// AppleScript: display a notification with args passed separately (avoids
// any shell/quote-escaping issues in the title/body).
const MACOS_NOTIFY_SCRIPT = [
  "on run argv",
  "  set theTitle to item 1 of argv",
  "  set theBody to item 2 of argv",
  '  display notification theBody with title theTitle sound name "Glass"',
  "end run",
].join("\n");

async function commandExists(command: string): Promise<boolean> {
  try {
    await execFileAsync("sh", ["-c", `command -v ${command}`]);
    return true;
  } catch {
    return false;
  }
}

/** Kitty OSC 99 */
function notifyOSC99(title: string, body: string): void {
  process.stdout.write(`\x1b]99;i=1:d=0;${title}\x1b\\`);
  process.stdout.write(`\x1b]99;i=1:p=body;${body}\x1b\\`);
}

/** OSC 777: Ghostty, iTerm2, WezTerm, rxvt-unicode */
function notifyOSC777(title: string, body: string): void {
  process.stdout.write(`\x1b]777;notify;${title};${body}\x07`);
}

function notifyTerminal(title: string, body: string): void {
  if (process.env.KITTY_WINDOW_ID) {
    notifyOSC99(title, body);
  } else {
    notifyOSC777(title, body);
  }
}

async function notifyMacOS(title: string, body: string): Promise<void> {
  await execFileAsync("osascript", ["-e", MACOS_NOTIFY_SCRIPT, title, body]);
}

async function notifyLinux(title: string, body: string): Promise<void> {
  if (await commandExists("notify-send")) {
    await execFileAsync("notify-send", ["--app-name", "pi", title, body]);
    return;
  }
  notifyTerminal(title, body);
}

async function sendNotification(body: string): Promise<void> {
  try {
    if (process.platform === "darwin") {
      await notifyMacOS(TITLE, body);
    } else if (process.platform === "linux") {
      await notifyLinux(TITLE, body);
    } else {
      notifyTerminal(TITLE, body);
    }
  } catch {
    // Notifications are best-effort. If the native path fails, fall back to a
    // terminal OSC escape so something still surfaces in supported terminals.
    notifyTerminal(TITLE, body);
  }
}

export default function (pi: ExtensionAPI) {
  pi.on("agent_settled", async () => {
    await sendNotification("Agent finished — ready for input");
  });
}
