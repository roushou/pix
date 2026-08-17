import { afterEach, describe, expect, test } from "bun:test";
import {
  DEFAULT_INTERACTIVE_COMMANDS,
  INTERACTIVE_COMMAND_GROUPS,
} from "../extensions/interactive-shell/commands.ts";
import { isInteractiveCommand } from "../extensions/interactive-shell/index.ts";

// Snapshot of the original flat list (pre-refactor), in original order.
const ORIGINAL = [
  "vim",
  "nvim",
  "vi",
  "nano",
  "emacs",
  "pico",
  "micro",
  "helix",
  "hx",
  "kak",
  "less",
  "more",
  "most",
  "git commit",
  "git rebase",
  "git merge",
  "git cherry-pick",
  "git revert",
  "git add -p",
  "git add --patch",
  "git add -i",
  "git add --interactive",
  "git stash -p",
  "git stash --patch",
  "git reset -p",
  "git reset --patch",
  "git checkout -p",
  "git checkout --patch",
  "git difftool",
  "git mergetool",
  "htop",
  "top",
  "btop",
  "glances",
  "ranger",
  "nnn",
  "lf",
  "mc",
  "vifm",
  "tig",
  "lazygit",
  "gitui",
  "fzf",
  "sk",
  "ssh",
  "telnet",
  "mosh",
  "psql",
  "mysql",
  "sqlite3",
  "mongosh",
  "redis-cli",
  "kubectl edit",
  "kubectl exec -it",
  "docker exec -it",
  "docker run -it",
  "tmux",
  "screen",
  "ncdu",
];

describe("command data", () => {
  test("flat list identical to original (order + content)", () => {
    expect(DEFAULT_INTERACTIVE_COMMANDS).toEqual(ORIGINAL);
  });
  test("flat list is the groups flattened", () => {
    expect(DEFAULT_INTERACTIVE_COMMANDS).toEqual(
      INTERACTIVE_COMMAND_GROUPS.flatMap((g) => g.commands),
    );
  });
  test("no duplicate entries", () => {
    expect(new Set(DEFAULT_INTERACTIVE_COMMANDS).size).toBe(DEFAULT_INTERACTIVE_COMMANDS.length);
  });
  test("every group has a name and commands", () => {
    for (const g of INTERACTIVE_COMMAND_GROUPS) {
      expect(typeof g.group).toBe("string");
      expect(g.commands.length).toBeGreaterThan(0);
    }
  });
});

describe("matching", () => {
  test("exact command", () => expect(isInteractiveCommand("vim")).toBe(true));
  test("command with arguments", () => expect(isInteractiveCommand("vim main.ts")).toBe(true));
  test("after a pipe", () => expect(isInteractiveCommand("cat x | less")).toBe(true));
  test("multi-word command prefix", () =>
    expect(isInteractiveCommand("git rebase -i HEAD~3")).toBe(true));
  test("docker exec -it prefix", () =>
    expect(isInteractiveCommand("docker exec -it mycontainer bash")).toBe(true));
  test("kubectl edit prefix", () =>
    expect(isInteractiveCommand("kubectl edit deploy/api")).toBe(true));
  test("ssh host", () => expect(isInteractiveCommand("ssh myserver")).toBe(true));
  test("plain command does not match", () => expect(isInteractiveCommand("ls -la")).toBe(false));
  test("vimdiff does not match vim (needs word boundary)", () =>
    expect(isInteractiveCommand("vimdiff a b")).toBe(false));
});

describe("env specs", () => {
  afterEach(() => {
    delete process.env.INTERACTIVE_COMMANDS;
    delete process.env.INTERACTIVE_EXCLUDE;
  });

  test("INTERACTIVE_COMMANDS adds commands", () => {
    process.env.INTERACTIVE_COMMANDS = "mycmd, othercmd";
    expect(isInteractiveCommand("mycmd arg")).toBe(true);
    expect(isInteractiveCommand("othercmd")).toBe(true);
  });

  test("INTERACTIVE_EXCLUDE removes defaults case-insensitively", () => {
    process.env.INTERACTIVE_EXCLUDE = "VIM,less";
    expect(isInteractiveCommand("vim")).toBe(false);
    expect(isInteractiveCommand("cat x | less")).toBe(false);
    expect(isInteractiveCommand("htop")).toBe(true);
  });
});
