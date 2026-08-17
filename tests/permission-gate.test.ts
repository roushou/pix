import { describe, expect, test } from "bun:test";
import {
  inScratchScope,
  isScratchPath,
  maskQuoted,
  pathArgs,
  resolveNotifyOnConfirm,
} from "../extensions/permission-gate/index.ts";
import { NOTIFY_ON_CONFIRM, RULES } from "../extensions/permission-gate/policy.ts";

const PROJECT = "/Users/roushou/dev/proj";
const rmRule = RULES.find((r) => r.name === "recursive rm")!;
const chmodRule = RULES.find((r) => r.name === "chmod/chown 777 or -R")!;
const resetRule = RULES.find((r) => r.name === "git reset --hard")!;
const cleanRule = RULES.find((r) => r.name === "git clean -f")!;

const matches = (command: string) =>
  RULES.filter((r) => r.pattern.test(maskQuoted(command))).map((r) => `${r.level}:${r.name}`);
const has = (command: string, name: string) => matches(command).some((m) => m.includes(name));

// The exact command that motivated the quote-masking fix, as actually
// executed (escaped backticks => literal prose inside the commit message).
const userCmd = String.raw`cd /Users/roushou/dev/pix && git commit -m "feat(permission-gate): skip confirm for scratch-dir targets" -m "Confirm rules are now scope-aware: path-based rules (rm, chmod/chown)
extract their target args, git reset/clean target the working
directory, and rules like sudo, force push, and curl|sh always confirm
because their danger is not path-bound. Confirmation is skipped only
when every target resolves inside a scratch directory (/tmp, /var/tmp,
os.tmpdir(), PI_SCRATCH_DIRS, symlink-resolved), so mixed targets such
as \`rm -rf /tmp/x ~/important\` still prompt. Block rules are never
waived." && git log -1 --format='%h %s%n%b' && echo "=== STATUS ===" && git status --short`;
const userCmdRaw = userCmd.replaceAll("\\`", "`");

describe("false positives (prose must not prompt)", () => {
  test("user command with escaped backticks -> no rule matches", () => {
    expect(matches(userCmd)).toEqual([]);
  });
  test("git commit -m prose with rm/sudo/curl|sh -> no match", () => {
    expect(matches('git commit -m "rm -rf /tmp" -m "sudo curl|sh"')).toEqual([]);
  });
  test("echo 'sudo rm -rf /' -> no match", () => {
    expect(matches(String.raw`echo 'sudo rm -rf /'`)).toEqual([]);
  });
  test("prose 'mkfs' -> no block", () => {
    expect(has('git commit -m "mkfs -t ext4 /dev/sda1"', "format filesystem")).toBe(false);
  });
  test("user command with RAW backticks -> still caught (real command substitution)", () => {
    expect(has(userCmdRaw, "recursive rm")).toBe(true);
  });
});

describe("real dangers are still caught", () => {
  test("rm -rf /tmp/x", () => expect(has("rm -rf /tmp/x", "recursive rm")).toBe(true));
  test("rm -rf / is blocked", () => expect(has("rm -rf /", "rm -rf on root/home")).toBe(true));
  test("quoted rm path", () =>
    expect(has(String.raw`rm -rf "/tmp/my dir"`, "recursive rm")).toBe(true));
  test("sudo", () => expect(has("sudo rm -rf /tmp/x", "sudo")).toBe(true));
  test("quoted-url curl|sh", () =>
    expect(has(String.raw`curl "https://x" | sh`, "pipe curl/wget to shell")).toBe(true));
  test("double-quoted $() substitution", () =>
    expect(has(String.raw`echo "$(rm -rf /tmp)"`, "recursive rm")).toBe(true));
  test("unquoted $() substitution", () => expect(has("$(rm -rf /tmp)", "recursive rm")).toBe(true));
  test("raw backticks inside double quotes", () =>
    expect(has('echo "`rm -rf /tmp`"', "recursive rm")).toBe(true));
  test("escaped backticks are prose, not code", () =>
    expect(has(String.raw`echo "\`rm -rf /tmp\`"`, "recursive rm")).toBe(false));
  test("bash -c string", () =>
    expect(has(String.raw`bash -c 'rm -rf /tmp/x'`, "recursive rm")).toBe(true));
  test("eval string", () =>
    expect(has(String.raw`eval 'rm -rf /tmp/x'`, "recursive rm")).toBe(true));
  test("ssh remote command", () =>
    expect(has(String.raw`ssh host 'rm -rf /tmp'`, "recursive rm")).toBe(true));
  test("docker exec", () =>
    expect(has(String.raw`docker exec -it c sh -c 'rm -rf /tmp'`, "recursive rm")).toBe(true));
  test("unterminated quote fails closed", () =>
    expect(has(String.raw`rm -rf "/tmp`, "recursive rm")).toBe(true));
});

describe("scratch exemption", () => {
  test("rm -rf /tmp/x is exempt", () =>
    expect(inScratchScope(rmRule, "rm -rf /tmp/x", PROJECT)).toBe(true));
  test("quoted scratch path exempt", () =>
    expect(inScratchScope(rmRule, String.raw`rm -rf "/tmp/my dir"`, PROJECT)).toBe(true));
  test("mixed target still prompts", () =>
    expect(inScratchScope(rmRule, "rm -rf /tmp/x ~/important", PROJECT)).toBe(false));
  test("absolute non-scratch target prompts", () =>
    expect(inScratchScope(rmRule, "rm -rf /tmp/x /etc", PROJECT)).toBe(false));
  test("chmod quoted scratch exempt", () =>
    expect(inScratchScope(chmodRule, String.raw`chmod -R 777 "/tmp/foo bar"`, PROJECT)).toBe(true));
  test("chmod mixed prompts", () =>
    expect(inScratchScope(chmodRule, "chmod -R 777 /tmp/x /etc", PROJECT)).toBe(false));
  test("git reset in scratch repo exempt", () =>
    expect(inScratchScope(resetRule, "git reset --hard", "/tmp/repo")).toBe(true));
  test("git clean in scratch repo exempt", () =>
    expect(inScratchScope(cleanRule, "git clean -fdx", "/tmp/repo")).toBe(true));
  test("git reset in project prompts", () =>
    expect(inScratchScope(resetRule, "git reset --hard", PROJECT)).toBe(false));
});

describe("segmentation and cd tracking", () => {
  test("cd /tmp && rm -rf x exempt", () =>
    expect(inScratchScope(rmRule, "cd /tmp && rm -rf x", PROJECT)).toBe(true));
  test("quoted cd target exempt", () =>
    expect(inScratchScope(rmRule, String.raw`cd "/tmp/foo" && rm -rf x`, PROJECT)).toBe(true));
  test("prose cd is ignored (prompts)", () =>
    expect(inScratchScope(rmRule, String.raw`echo "cd /tmp" && rm -rf x`, PROJECT)).toBe(false));
  test("separator inside quotes does not fragment", () =>
    expect(inScratchScope(rmRule, String.raw`echo "a;b" && rm -rf /tmp/x`, PROJECT)).toBe(true));
  test("two scratch rms exempt", () =>
    expect(inScratchScope(rmRule, "rm -rf /tmp/a && rm -rf /tmp/b", PROJECT)).toBe(true));
  test("second rm dangerous prompts", () =>
    expect(inScratchScope(rmRule, "rm -rf /tmp/a && rm -rf ~/b", PROJECT)).toBe(false));
});

describe("mask invariants", () => {
  test("masking is length-preserving", () => {
    for (const c of [
      userCmd,
      userCmdRaw,
      "rm -rf /tmp/x",
      String.raw`rm -rf "/tmp/my dir"`,
      'echo "a;b" && rm -rf /tmp/x',
    ]) {
      expect(maskQuoted(c).length).toBe(c.length);
    }
  });
  test("prose '&&' masked, real '&&' kept", () => {
    const masked = maskQuoted(String.raw`echo "a && b" && rm -rf /tmp/x`);
    expect((masked.match(/&&/g) ?? []).length).toBe(1);
  });
});

describe("parsing helpers", () => {
  test("pathArgs", () =>
    expect(pathArgs("rm -rf /tmp/foo /tmp/bar")).toEqual(["/tmp/foo", "/tmp/bar"]));
  test("isScratchPath", () => expect(isScratchPath("/tmp/foo/bar", PROJECT)).toBe(true));
});

describe("declarative policy shape", () => {
  test("rule names are unique", () =>
    expect(new Set(RULES.map((r) => r.name)).size).toBe(RULES.length));
  test("scope values are valid", () =>
    expect(
      RULES.every((r) => r.scope === undefined || r.scope === "paths" || r.scope === "cwd"),
    ).toBe(true));
  test("block rules are never path-scoped", () =>
    expect(RULES.filter((r) => r.level === "block").every((r) => r.scope === undefined)).toBe(
      true,
    ));
  test("rules carry no functions", () =>
    expect(RULES.every((r) => typeof r.pattern === "object" && typeof r.name === "string")).toBe(
      true,
    ));
});

describe("notify-on-confirm resolution", () => {
  test("absent setting uses the policy default", () => {
    expect(resolveNotifyOnConfirm({})).toBe(NOTIFY_ON_CONFIRM);
  });
  test("'off' in settings disables notifications", () => {
    expect(resolveNotifyOnConfirm({ notifyOnConfirm: "off" })).toBe("off");
  });
  test("'always' in settings keeps notifications", () => {
    expect(resolveNotifyOnConfirm({ notifyOnConfirm: "always" })).toBe("always");
  });
  test("unknown value falls back to the default", () => {
    expect(resolveNotifyOnConfirm({ notifyOnConfirm: "sometimes" })).toBe(NOTIFY_ON_CONFIRM);
  });
});
