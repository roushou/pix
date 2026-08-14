/**
 * minimal-mode — compact rendering for built-in tools.
 *
 * Overrides only the rendering of the built-in tools (read, bash, edit,
 * write, find, grep, ls); execution stays identical. Collapsed results show
 * just the call plus a one-line summary (e.g. "grep → 12 matches") instead of
 * the full output dump, and Ctrl+O still expands to the full output.
 */

import { homedir } from "node:os";
import {
  createBashTool,
  createEditTool,
  createFindTool,
  createGrepTool,
  createLsTool,
  createReadTool,
  createWriteTool,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

function shortenPath(path: string): string {
  const home = homedir();
  if (path.startsWith(home)) {
    return `~${path.slice(home.length)}`;
  }
  return path;
}

function createBuiltInTools(cwd: string) {
  return {
    read: createReadTool(cwd),
    bash: createBashTool(cwd),
    edit: createEditTool(cwd),
    write: createWriteTool(cwd),
    find: createFindTool(cwd),
    grep: createGrepTool(cwd),
    ls: createLsTool(cwd),
  };
}

const toolCache = new Map<string, ReturnType<typeof createBuiltInTools>>();

function getBuiltInTools(cwd: string) {
  let tools = toolCache.get(cwd);
  if (!tools) {
    tools = createBuiltInTools(cwd);
    toolCache.set(cwd, tools);
  }
  return tools;
}

// Text of a tool result, or undefined when there is none.
function resultText(result: { content: { type: string; text?: string }[] }): string | undefined {
  const block = result.content.find((c) => c.type === "text");
  return block?.type === "text" ? block.text : undefined;
}

function countLines(text: string): number {
  return text.trim().split("\n").filter(Boolean).length;
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "read",
    label: "read",
    description:
      "Read the contents of a file. Supports text files and images (jpg, png, gif, webp). Images are sent as attachments. For text files, output is truncated to 2000 lines or 50KB (whichever is hit first). Use offset/limit for large files.",
    parameters: getBuiltInTools(process.cwd()).read.parameters,

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return getBuiltInTools(ctx.cwd).read.execute(toolCallId, params, signal, onUpdate);
    },

    renderCall(args, theme, _context) {
      const path = shortenPath(args.path || "");
      let pathDisplay = path ? theme.fg("accent", path) : theme.fg("toolOutput", "...");
      if (args.offset !== undefined || args.limit !== undefined) {
        const startLine = args.offset ?? 1;
        const endLine = args.limit !== undefined ? startLine + args.limit - 1 : "";
        pathDisplay += theme.fg("warning", `:${startLine}${endLine ? `-${endLine}` : ""}`);
      }
      return new Text(`${theme.fg("toolTitle", theme.bold("read"))} ${pathDisplay}`, 0, 0);
    },

    renderResult(result, { expanded }, theme, _context) {
      if (!expanded) return new Text("", 0, 0);
      const text = resultText(result);
      if (!text) return new Text("", 0, 0);
      return new Text(`\n${theme.fg("toolOutput", text)}`, 0, 0);
    },
  });

  pi.registerTool({
    name: "bash",
    label: "bash",
    description:
      "Execute a bash command in the current working directory. Returns stdout and stderr. Output is truncated to last 2000 lines or 50KB (whichever is hit first).",
    parameters: getBuiltInTools(process.cwd()).bash.parameters,

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return getBuiltInTools(ctx.cwd).bash.execute(toolCallId, params, signal, onUpdate);
    },

    renderCall(args, theme, _context) {
      const command = args.command || "...";
      const timeout = args.timeout as number | undefined;
      const timeoutSuffix = timeout ? theme.fg("muted", ` (timeout ${timeout}s)`) : "";
      return new Text(theme.fg("toolTitle", theme.bold(`$ ${command}`)) + timeoutSuffix, 0, 0);
    },

    renderResult(result, { expanded }, theme, _context) {
      if (!expanded) return new Text("", 0, 0);
      const text = resultText(result);
      if (!text) return new Text("", 0, 0);
      const output = text
        .trim()
        .split("\n")
        .map((line) => theme.fg("toolOutput", line))
        .join("\n");
      return output ? new Text(`\n${output}`, 0, 0) : new Text("", 0, 0);
    },
  });

  pi.registerTool({
    name: "write",
    label: "write",
    description:
      "Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.",
    parameters: getBuiltInTools(process.cwd()).write.parameters,

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return getBuiltInTools(ctx.cwd).write.execute(toolCallId, params, signal, onUpdate);
    },

    renderCall(args, theme, _context) {
      const pathDisplay = args.path
        ? theme.fg("accent", shortenPath(args.path))
        : theme.fg("toolOutput", "...");
      const lineCount = args.content ? args.content.split("\n").length : 0;
      const lineInfo = lineCount > 0 ? theme.fg("muted", ` (${lineCount} lines)`) : "";
      return new Text(
        `${theme.fg("toolTitle", theme.bold("write"))} ${pathDisplay}${lineInfo}`,
        0,
        0,
      );
    },

    renderResult(result, { expanded }, theme, _context) {
      if (!expanded) return new Text("", 0, 0);
      const text = resultText(result);
      return text ? new Text(`\n${theme.fg("error", text)}`, 0, 0) : new Text("", 0, 0);
    },
  });

  pi.registerTool({
    name: "edit",
    label: "edit",
    description:
      "Edit a file by replacing exact text. The oldText must match exactly (including whitespace). Use this for precise, surgical edits.",
    parameters: getBuiltInTools(process.cwd()).edit.parameters,

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return getBuiltInTools(ctx.cwd).edit.execute(toolCallId, params, signal, onUpdate);
    },

    renderCall(args, theme, _context) {
      const pathDisplay = args.path
        ? theme.fg("accent", shortenPath(args.path))
        : theme.fg("toolOutput", "...");
      return new Text(`${theme.fg("toolTitle", theme.bold("edit"))} ${pathDisplay}`, 0, 0);
    },

    renderResult(result, { expanded }, theme, _context) {
      if (!expanded) return new Text("", 0, 0);
      const text = resultText(result);
      if (!text) return new Text("", 0, 0);
      const color = /error/i.test(text) ? "error" : "toolOutput";
      return new Text(`\n${theme.fg(color, text)}`, 0, 0);
    },
  });

  pi.registerTool({
    name: "find",
    label: "find",
    description:
      "Find files by name pattern (glob). Searches recursively from the specified path. Output limited to 200 results.",
    parameters: getBuiltInTools(process.cwd()).find.parameters,

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return getBuiltInTools(ctx.cwd).find.execute(toolCallId, params, signal, onUpdate);
    },

    renderCall(args, theme, _context) {
      let text = `${theme.fg("toolTitle", theme.bold("find"))} ${theme.fg("accent", args.pattern || "")}`;
      text += theme.fg("toolOutput", ` in ${shortenPath(args.path || ".")}`);
      if (args.limit !== undefined) text += theme.fg("toolOutput", ` (limit ${args.limit})`);
      return new Text(text, 0, 0);
    },

    renderResult(result, { expanded }, theme, _context) {
      const text = resultText(result);
      if (!expanded) {
        const count = text ? countLines(text) : 0;
        return count > 0
          ? new Text(theme.fg("muted", ` → ${count} files`), 0, 0)
          : new Text("", 0, 0);
      }
      if (!text) return new Text("", 0, 0);
      return new Text(`\n${theme.fg("toolOutput", text.trim())}`, 0, 0);
    },
  });

  pi.registerTool({
    name: "grep",
    label: "grep",
    description:
      "Search file contents by regex pattern. Uses ripgrep for fast searching. Output limited to 200 matches.",
    parameters: getBuiltInTools(process.cwd()).grep.parameters,

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return getBuiltInTools(ctx.cwd).grep.execute(toolCallId, params, signal, onUpdate);
    },

    renderCall(args, theme, _context) {
      let text = `${theme.fg("toolTitle", theme.bold("grep"))} ${theme.fg("accent", `/${args.pattern || ""}/`)}`;
      text += theme.fg("toolOutput", ` in ${shortenPath(args.path || ".")}`);
      if (args.glob) text += theme.fg("toolOutput", ` (${args.glob})`);
      if (args.limit !== undefined) text += theme.fg("toolOutput", ` limit ${args.limit}`);
      return new Text(text, 0, 0);
    },

    renderResult(result, { expanded }, theme, _context) {
      const text = resultText(result);
      if (!expanded) {
        const count = text ? countLines(text) : 0;
        return count > 0
          ? new Text(theme.fg("muted", ` → ${count} matches`), 0, 0)
          : new Text("", 0, 0);
      }
      if (!text) return new Text("", 0, 0);
      return new Text(`\n${theme.fg("toolOutput", text.trim())}`, 0, 0);
    },
  });

  pi.registerTool({
    name: "ls",
    label: "ls",
    description:
      "List directory contents with file sizes. Shows files and directories with their sizes. Output limited to 500 entries.",
    parameters: getBuiltInTools(process.cwd()).ls.parameters,

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return getBuiltInTools(ctx.cwd).ls.execute(toolCallId, params, signal, onUpdate);
    },

    renderCall(args, theme, _context) {
      let text = `${theme.fg("toolTitle", theme.bold("ls"))} ${theme.fg("accent", shortenPath(args.path || "."))}`;
      if (args.limit !== undefined) text += theme.fg("toolOutput", ` (limit ${args.limit})`);
      return new Text(text, 0, 0);
    },

    renderResult(result, { expanded }, theme, _context) {
      const text = resultText(result);
      if (!expanded) {
        const count = text ? countLines(text) : 0;
        return count > 0
          ? new Text(theme.fg("muted", ` → ${count} entries`), 0, 0)
          : new Text("", 0, 0);
      }
      if (!text) return new Text("", 0, 0);
      return new Text(`\n${theme.fg("toolOutput", text.trim())}`, 0, 0);
    },
  });
}
