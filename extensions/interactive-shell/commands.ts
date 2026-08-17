/**
 * Interactive command policy — declarative data for the interactive-shell
 * extension.
 *
 * Pure data, no logic: the engine in index.ts interprets this file. Commands
 * are grouped by category so the list stays scannable; the engine flattens
 * the groups into the matching set. Order within the file has no semantic
 * meaning. The env specs (see shared/config.ts) let users add commands or
 * exclude defaults per process.
 */

import type { ConfigSpec } from "../shared/config.ts";
import { splitComma } from "../shared/config.ts";

export interface CommandGroup {
  group: string;
  commands: string[];
}

export const INTERACTIVE_COMMAND_GROUPS: CommandGroup[] = [
  {
    group: "Editors",
    commands: ["vim", "nvim", "vi", "nano", "emacs", "pico", "micro", "helix", "hx", "kak"],
  },
  { group: "Pagers", commands: ["less", "more", "most"] },
  {
    group: "Git interactive",
    commands: [
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
    ],
  },
  { group: "System monitors", commands: ["htop", "top", "btop", "glances"] },
  { group: "File managers", commands: ["ranger", "nnn", "lf", "mc", "vifm"] },
  { group: "Git TUIs", commands: ["tig", "lazygit", "gitui"] },
  { group: "Fuzzy finders", commands: ["fzf", "sk"] },
  { group: "Remote sessions", commands: ["ssh", "telnet", "mosh"] },
  {
    group: "Database clients",
    commands: ["psql", "mysql", "sqlite3", "mongosh", "redis-cli"],
  },
  {
    group: "Kubernetes/Docker",
    commands: ["kubectl edit", "kubectl exec -it", "docker exec -it", "docker run -it"],
  },
  { group: "Other", commands: ["tmux", "screen", "ncdu"] },
];

/** Flat list of default interactive commands (group order preserved). */
export const DEFAULT_INTERACTIVE_COMMANDS: string[] = INTERACTIVE_COMMAND_GROUPS.flatMap(
  (g) => g.commands,
);

/** Env additions (INTERACTIVE_COMMANDS, comma-separated) on top of the default. */
export const ADDITIONAL_COMMANDS_SPEC: ConfigSpec<string[]> = {
  key: "INTERACTIVE_COMMANDS",
  channel: "env",
  merge: "union",
  default: [],
  parse: splitComma,
};

/** Env exclusions (INTERACTIVE_EXCLUDE, comma-separated), matched case-insensitively. */
export const EXCLUDE_COMMANDS_SPEC: ConfigSpec<string[]> = {
  key: "INTERACTIVE_EXCLUDE",
  channel: "env",
  merge: "union",
  default: [],
  parse: (raw) => splitComma(raw).map((s) => s.toLowerCase()),
};
