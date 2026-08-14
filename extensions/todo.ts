/**
 * todo — persistent task tracker for the agent.
 *
 * - Registers a `todo` tool the LLM uses to manage a list (list/add/toggle/clear).
 * - Renders the list as a persistent widget above the editor.
 * - `/todos` toggles the widget visibility.
 *
 * State is stored in tool-result details, so it survives restarts and stays
 * correct when branching (each branch point carries its own todo snapshot).
 */

import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth, type TUI } from "@earendil-works/pi-tui";
import { Type } from "typebox";

const MAX_VISIBLE = 6;

interface Todo {
  id: number;
  text: string;
  done: boolean;
}

interface TodoDetails {
  action: "list" | "add" | "toggle" | "clear";
  todos: Todo[];
  nextId: number;
  error?: string;
}

const TodoParams = Type.Object({
  action: StringEnum(["list", "add", "toggle", "clear"] as const),
  text: Type.Optional(Type.String({ description: "Todo text (for add)" })),
  id: Type.Optional(Type.Number({ description: "Todo ID (for toggle)" })),
});

export default function (pi: ExtensionAPI) {
  let todos: Todo[] = [];
  let nextId = 1;
  let activeTui: TUI | undefined;
  let widgetVisible = true;

  const requestRender = () => activeTui?.requestRender();

  // Rebuild in-memory state from the current branch's tool results.
  const reconstruct = (ctx: ExtensionContext) => {
    todos = [];
    nextId = 1;
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "message") continue;
      const msg = entry.message;
      if (msg.role !== "toolResult" || msg.toolName !== "todo") continue;
      const details = msg.details as TodoDetails | undefined;
      if (details) {
        todos = details.todos;
        nextId = details.nextId;
      }
    }
  };

  const renderLines = (theme: Theme, width: number): string[] => {
    if (!widgetVisible || todos.length === 0) return [];
    const done = todos.filter((t) => t.done).length;
    const lines: string[] = [theme.fg("accent", `TODO ${done}/${todos.length}`)];
    for (const t of todos.slice(0, MAX_VISIBLE)) {
      const check = t.done ? theme.fg("success", "✓") : theme.fg("dim", "○");
      const text = t.done ? theme.fg("dim", t.text) : t.text;
      lines.push(`${check} ${theme.fg("muted", `#${t.id}`)} ${text}`);
    }
    if (todos.length > MAX_VISIBLE) {
      lines.push(theme.fg("dim", `… ${todos.length - MAX_VISIBLE} more (hide with /todos)`));
    }
    return lines.map((line) => truncateToWidth(line, width));
  };

  const installWidget = (ctx: ExtensionContext) => {
    ctx.ui.setWidget(
      "todo",
      (tui, theme) => {
        activeTui = tui;
        return {
          invalidate() {},
          render(width: number): string[] {
            return renderLines(theme, width);
          },
          dispose() {
            if (activeTui === tui) activeTui = undefined;
          },
        };
      },
      { placement: "aboveEditor" },
    );
  };

  pi.on("session_start", (_event, ctx) => {
    reconstruct(ctx);
    installWidget(ctx);
  });

  pi.on("session_tree", (_event, ctx) => {
    reconstruct(ctx);
    requestRender();
  });

  pi.registerTool({
    name: "todo",
    label: "Todo",
    description: "Manage a persistent todo list. Actions: list, add (text), toggle (id), clear.",
    parameters: TodoParams,

    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      switch (params.action) {
        case "list": {
          const text = todos.length
            ? todos.map((t) => `[${t.done ? "x" : " "}] #${t.id}: ${t.text}`).join("\n")
            : "No todos";
          return {
            content: [{ type: "text", text }],
            details: { action: "list", todos: [...todos], nextId } as TodoDetails,
          };
        }

        case "add": {
          if (!params.text) {
            return {
              content: [{ type: "text", text: "Error: text required for add" }],
              details: {
                action: "add",
                todos: [...todos],
                nextId,
                error: "text required",
              } as TodoDetails,
            };
          }
          const todo: Todo = { id: nextId++, text: params.text, done: false };
          todos.push(todo);
          requestRender();
          return {
            content: [{ type: "text", text: `Added todo #${todo.id}: ${todo.text}` }],
            details: { action: "add", todos: [...todos], nextId } as TodoDetails,
          };
        }

        case "toggle": {
          if (params.id === undefined) {
            return {
              content: [{ type: "text", text: "Error: id required for toggle" }],
              details: {
                action: "toggle",
                todos: [...todos],
                nextId,
                error: "id required",
              } as TodoDetails,
            };
          }
          const todo = todos.find((t) => t.id === params.id);
          if (!todo) {
            return {
              content: [{ type: "text", text: `Todo #${params.id} not found` }],
              details: {
                action: "toggle",
                todos: [...todos],
                nextId,
                error: `#${params.id} not found`,
              } as TodoDetails,
            };
          }
          todo.done = !todo.done;
          requestRender();
          return {
            content: [
              { type: "text", text: `Todo #${todo.id} ${todo.done ? "completed" : "reopened"}` },
            ],
            details: { action: "toggle", todos: [...todos], nextId } as TodoDetails,
          };
        }

        case "clear": {
          const count = todos.length;
          todos = [];
          nextId = 1;
          requestRender();
          return {
            content: [{ type: "text", text: `Cleared ${count} todos` }],
            details: { action: "clear", todos: [], nextId: 1 } as TodoDetails,
          };
        }

        default:
          return {
            content: [{ type: "text", text: `Unknown action: ${String(params.action)}` }],
            details: { action: "list", todos: [...todos], nextId } as TodoDetails,
          };
      }
    },

    renderResult(result, _options, theme) {
      const details = result.details as TodoDetails | undefined;
      if (!details) return new Text("", 0, 0);
      if (details.error) return new Text(theme.fg("error", `Error: ${details.error}`), 0, 0);

      if (details.action === "list") {
        if (details.todos.length === 0) return new Text(theme.fg("dim", "No todos"), 0, 0);
        const lines = details.todos.map((t) => {
          const check = t.done ? theme.fg("success", "✓") : theme.fg("dim", "○");
          return `${check} ${theme.fg("muted", `#${t.id}`)} ${t.done ? theme.fg("dim", t.text) : t.text}`;
        });
        return new Text(lines.join("\n"), 0, 0);
      }

      const text = result.content[0];
      return new Text(theme.fg("muted", text?.type === "text" ? text.text : ""), 0, 0);
    },
  });

  pi.registerCommand("todos", {
    description: "Toggle the todo list above the editor",
    handler: async (_args, ctx) => {
      widgetVisible = !widgetVisible;
      requestRender();
      ctx.ui.notify(widgetVisible ? "Todo list visible" : "Todo list hidden", "info");
    },
  });
}
