/**
 * charts — native inline charts & diagrams as pi tools.
 *
 * Registers two tools the LLM can call directly (no subprocess, no Python):
 *
 *   chart   — bar (vertical/horizontal), line, scatter, histogram, sparkline
 *   diagram — architecture/flow (boxes + arrows) and tree hierarchies
 *
 * Everything renders as inline Unicode text, so it works in the TUI and in
 * print/json modes alike. All logic is pure TypeScript using only the JS
 * standard library.
 */

import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const BLOCKS = " ▁▂▃▄▅▆▇█";
const BRAILLE_DOTS = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
] as const;

const H = "─";
const V = "│";
const TL = "┌";
const TR = "┐";
const BL = "└";
const BR = "┘";
const ARROW = "▶";

const fmt = (n: number): string => {
  const r = Math.round(n * 100) / 100;
  return Number.isInteger(r) ? String(r) : String(r);
};

// --------------------------------------------------------------------------- //
// Bar / sparkline / histogram
// --------------------------------------------------------------------------- //
export function barChart(
  values: number[],
  labels: string[],
  opts: { horizontal?: boolean; height?: number; width?: number } = {},
): string {
  if (!values.length) return "(no data)";
  const horizontal = opts.horizontal ?? false;
  const height = opts.height ?? 8;
  const width = opts.width ?? 40;
  const maxv = Math.max(...values) || 1;
  const lines: string[] = [];

  if (horizontal) {
    const maxlabel = Math.max(...labels.map((l) => l.length));
    for (let i = 0; i < values.length; i++) {
      const v = values[i]!;
      const frac = v / maxv;
      const n = Math.round(frac * width);
      const bar = "█".repeat(n) || (v !== 0 ? "▏" : "");
      lines.push(`${labels[i]!.padStart(maxlabel)} │${bar}${v ? ` ${fmt(v)}` : ""}`);
    }
    return lines.join("\n");
  }

  for (let row = height; row > 0; row--) {
    let line = "";
    for (const v of values) {
      const filled = (v / maxv) * height;
      const full = Math.floor(filled);
      if (full >= row) line += "█";
      else if (full === row - 1) line += BLOCKS[Math.round((filled - full) * 8)] ?? "█";
      else line += " ";
    }
    lines.push(line.replace(/\s+$/, ""));
  }
  lines.push(H.repeat(values.length));
  lines.push(labels.map((l) => l.slice(0, 6)).join(" "));
  return lines.join("\n");
}

export function sparkline(values: number[], _width?: number): string {
  if (!values.length) return "(no data)";
  const ymin = Math.min(...values);
  const ymax = Math.max(...values);
  const yr = ymax - ymin || 1;
  let out = "";
  for (const v of values) {
    const idx = 1 + Math.round(((v - ymin) / yr) * 7);
    out += BLOCKS[idx];
  }
  return `${out}\n${fmt(ymin)} … ${fmt(ymax)}`;
}

export function histogram(values: number[], bins = 10, height = 8): string {
  if (!values.length) return "(no data)";
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (lo === hi) {
    lo -= 0.5;
    hi += 0.5;
  }
  const bw = (hi - lo) / bins;
  const counts = Array.from({ length: bins }, () => 0);
  for (const v of values) {
    const idx = Math.min(bins - 1, Math.floor((v - lo) / bw));
    counts[idx]! += 1;
  }
  const labels = counts.map((_, i) => fmt(lo + i * bw));
  return barChart(counts, labels, { height });
}

// --------------------------------------------------------------------------- //
// Braille line / scatter
// --------------------------------------------------------------------------- //
function renderBraille(
  points: Array<[number, number]>,
  width: number,
  height: number,
  xmin: number,
  xmax: number,
  ymin: number,
  ymax: number,
): string {
  const canvas: number[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => 0),
  );
  const xr = xmax - xmin || 1;
  const yr = ymax - ymin || 1;
  for (const [x, y] of points) {
    const px = Math.round(((x - xmin) / xr) * (width * 2 - 1));
    const py = Math.round(((y - ymin) / yr) * (height * 4 - 1));
    if (px < 0 || py < 0) continue;
    const cx = Math.floor(px / 2);
    const cy = Math.floor(py / 4);
    if (cx >= width || cy >= height) continue;
    canvas[cy]![cx]! |= BRAILLE_DOTS[py % 4]![px % 2]!;
  }
  return canvas
    .map((row) => row.map((c) => (c ? String.fromCharCode(0x2800 + c) : " ")).join(""))
    .join("\n");
}

export function lineChart(values: number[], width = 60, height = 20): string {
  if (values.length < 2) return "(need ≥2 points)";
  const xmin = 0;
  const xmax = values.length - 1;
  let ymin = Math.min(...values);
  let ymax = Math.max(...values);
  const pad = (ymax - ymin) * 0.05 || 1;
  ymin -= pad;
  ymax += pad;
  const points: Array<[number, number]> = [];
  const steps = width * 2;
  for (let i = 0; i < values.length - 1; i++) {
    for (let t = 0; t < steps; t++) {
      const f = t / steps;
      points.push([i + f, values[i]! + (values[i + 1]! - values[i]!) * f]);
    }
  }
  points.push([xmax, values[values.length - 1]!]);
  return renderBraille(points, width, height, xmin, xmax, ymin, ymax);
}

export function scatterPlot(xs: number[], ys: number[], width = 60, height = 20): string {
  if (!xs.length || xs.length !== ys.length) return "(need equal-length x,y)";
  let xmin = Math.min(...xs);
  let xmax = Math.max(...xs);
  let ymin = Math.min(...ys);
  let ymax = Math.max(...ys);
  const xpad = (xmax - xmin) * 0.1 || 1;
  const ypad = (ymax - ymin) * 0.1 || 1;
  const points: Array<[number, number]> = xs.map((x, i) => [x, ys[i]!]);
  return renderBraille(points, width, height, xmin - xpad, xmax + xpad, ymin - ypad, ymax + ypad);
}

// --------------------------------------------------------------------------- //
// Flow diagram (layered boxes + arrows)
// --------------------------------------------------------------------------- //
export function parseEdges(lines: string[]): Array<[string, string]> {
  const edges: Array<[string, string]> = [];
  for (const raw of lines) {
    for (const seg of raw.split(/[;\n]/)) {
      const s = seg.split("#")[0]!.trim();
      if (!s) continue;
      const nodes = s
        .split(/\s*(?:->|-->|=>|–>|→)\s*/)
        .map((t) => t.trim())
        .filter(Boolean);
      for (let i = 0; i + 1 < nodes.length; i++) edges.push([nodes[i]!, nodes[i + 1]!]);
    }
  }
  return edges;
}

function nodeOrder(edges: Array<[string, string]>): string[] {
  const order: string[] = [];
  const seen = new Set<string>();
  for (const [a, b] of edges) {
    if (!seen.has(a)) {
      seen.add(a);
      order.push(a);
    }
    if (!seen.has(b)) {
      seen.add(b);
      order.push(b);
    }
  }
  return order;
}

function computeLayers(nodes: string[], edges: Array<[string, string]>): Map<string, number> {
  const indeg = new Map<string, number>(nodes.map((n) => [n, 0]));
  const adj = new Map<string, string[]>(nodes.map((n) => [n, []]));
  for (const [a, b] of edges) {
    adj.get(a)!.push(b);
    indeg.set(b, (indeg.get(b) ?? 0) + 1);
  }
  const layer = new Map<string, number>(nodes.map((n) => [n, 0]));
  const queue = nodes.filter((n) => indeg.get(n) === 0);
  const visited: string[] = [];
  while (queue.length) {
    const n = queue.shift()!;
    visited.push(n);
    for (const m of adj.get(n)!) {
      layer.set(m, Math.max(layer.get(m)!, layer.get(n)! + 1));
      indeg.set(m, indeg.get(m)! - 1);
      if (indeg.get(m) === 0) queue.push(m);
    }
  }
  const seen = new Set(visited);
  for (const n of nodes) {
    if (!seen.has(n)) {
      for (const [a, b] of edges) {
        if (b === n) layer.set(n, Math.max(layer.get(n)!, (layer.get(a) ?? 0) + 1));
      }
    }
  }
  return layer;
}

export function flowDiagram(edges: Array<[string, string]>): string {
  if (!edges.length) return "(no edges)";
  const nodes = nodeOrder(edges);
  const layer = computeLayers(nodes, edges);
  const layers = new Map<number, string[]>();
  for (const n of nodes) {
    const L = layer.get(n)!;
    if (!layers.has(L)) layers.set(L, []);
    layers.get(L)!.push(n);
  }
  const orderedLayers = [...layers.keys()].toSorted((a, b) => a - b);

  const colWidths = new Map<number, number>();
  for (const L of orderedLayers)
    colWidths.set(L, Math.max(...layers.get(L)!.map((n) => n.length)) + 2 + 4);

  const xpos = new Map<number, number>();
  let x = 0;
  for (const L of orderedLayers) {
    xpos.set(L, x);
    x += colWidths.get(L)! + 4;
  }
  const totalWidth = x;

  const ypos = new Map<string, number>();
  for (const L of orderedLayers) {
    let y = 0;
    for (const n of layers.get(L)!) {
      ypos.set(n, y);
      y += 4;
    }
  }
  const totalHeight = Math.max(...ypos.values()) + 3;

  const grid: string[][] = Array.from({ length: totalHeight }, () =>
    Array.from({ length: totalWidth }, () => " "),
  );
  const geom = new Map<string, [number, number, number, number]>();

  for (const L of orderedLayers) {
    const col = xpos.get(L)!;
    const width = colWidths.get(L)!;
    for (const n of layers.get(L)!) {
      const y0 = ypos.get(n)!;
      const w = n.length + 2;
      const x0 = col + Math.floor((width - w) / 2);
      grid[y0]![x0] = TL;
      grid[y0]![x0 + w - 1] = TR;
      grid[y0 + 1]![x0] = V;
      grid[y0 + 1]![x0 + w - 1] = V;
      grid[y0 + 2]![x0] = BL;
      grid[y0 + 2]![x0 + w - 1] = BR;
      for (let i = 1; i < w - 1; i++) {
        grid[y0]![x0 + i] = H;
        grid[y0 + 2]![x0 + i] = H;
      }
      for (let i = 0; i < n.length; i++) grid[y0 + 1]![x0 + 1 + i] = n[i]!;
      geom.set(n, [x0, y0, x0 + w - 1, y0 + 2]);
    }
  }

  const put = (yy: number, xx: number, ch: string) => {
    if (yy >= 0 && yy < totalHeight && xx >= 0 && xx < totalWidth && grid[yy]![xx] === " ")
      grid[yy]![xx] = ch;
  };

  for (const [a, b] of edges) {
    if (a === b || !geom.has(a) || !geom.has(b)) continue;
    const [, ay0, ax1] = geom.get(a)!;
    const [bx0, by0] = geom.get(b)!;
    const sy = ay0 + 1;
    const ty = by0 + 1;
    const sx0 = ax1 + 1;
    const tx0 = bx0 - 1;

    if (bx0 > ax1) {
      // Forward: route through the gap just left of the target column.
      const gx = xpos.get(layer.get(b)!)! - 2;
      if (sy === ty) {
        for (let xx = sx0; xx < tx0; xx++) put(sy, xx, H);
      } else {
        for (let xx = sx0; xx < gx; xx++) put(sy, xx, H);
        const step = ty > sy ? 1 : -1;
        for (let yy = sy; yy !== ty; yy += step) put(yy, gx, V);
        grid[ty]![gx] = ty > sy ? "└" : "┌";
        for (let xx = gx + 1; xx < tx0; xx++) put(ty, xx, H);
      }
      grid[ty]![tx0] = ARROW;
    } else {
      // Backward/same-column edge: best-effort direct connector.
      if (sy === ty) {
        for (let xx = tx0 + 1; xx < sx0; xx++) put(sy, xx, H);
        grid[sy]![tx0] = "◀";
      } else {
        const step = ty > sy ? 1 : -1;
        for (let yy = sy; yy !== ty; yy += step) put(yy, tx0 + 1, V);
        if (ty >= 0 && ty < totalHeight && tx0 + 1 >= 0 && tx0 + 1 < totalWidth) {
          grid[ty]![tx0 + 1] = ty > sy ? "└" : "┌";
        }
        for (let xx = tx0 + 2; xx < sx0; xx++) put(ty, xx, H);
        if (tx0 >= 0 && tx0 < totalWidth) grid[ty]![tx0] = "◀";
      }
    }
  }

  return grid.map((row) => row.join("").replace(/\s+$/, "")).join("\n");
}

// --------------------------------------------------------------------------- //
// Tree diagram
// --------------------------------------------------------------------------- //
export function treeDiagram(lines: string[]): string {
  const items: Array<[number, string]> = [];
  for (const raw of lines) {
    const ln = raw.replace(/\t/g, "  ");
    const stripped = ln.replace(/^ +/, "");
    const leading = ln.length - stripped.length;
    const depth = Math.floor(leading / 2);
    if (stripped === "") continue;
    items.push([depth, stripped]);
  }
  if (!items.length) return "(no input)";

  const hasLaterSibling = (i: number, level: number): boolean => {
    for (let j = i + 1; j < items.length; j++) {
      const d = items[j]![0];
      if (d < level) return false;
      if (d === level) return true;
    }
    return false;
  };
  const isLastChild = (i: number): boolean => {
    const d = items[i]![0];
    for (let j = i + 1; j < items.length; j++) {
      const dj = items[j]![0];
      if (dj < d) return true;
      if (dj === d) return false;
    }
    return true;
  };

  const out: string[] = [];
  for (let i = 0; i < items.length; i++) {
    const [d, label] = items[i]!;
    if (i === 0) {
      out.push(label);
      continue;
    }
    let prefix = "";
    for (let level = 1; level < d; level++) prefix += hasLaterSibling(i, level) ? "│  " : "   ";
    out.push(prefix + (isLastChild(i) ? "└── " : "├── ") + label);
  }
  return out.join("\n");
}

// --------------------------------------------------------------------------- //
// Tool registration
// --------------------------------------------------------------------------- //
export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "chart",
    label: "Chart",
    description:
      "Draw an inline Unicode chart in the terminal: bar, line, scatter, histogram, or sparkline. Use for visualizing numeric data.",
    promptSnippet: "Draw an inline Unicode chart (bar/line/scatter/histogram/sparkline)",
    promptGuidelines: [
      "Use the chart tool to visualize numeric data (timings, sizes, counts, distributions) when a picture is clearer than raw numbers.",
      "Always state where the numbers came from and add a one-sentence reading of the chart.",
    ],
    parameters: Type.Object({
      kind: StringEnum(["bar", "line", "scatter", "spark", "hist"] as const),
      values: Type.Array(Type.Number(), { description: "Data values to plot" }),
      labels: Type.Optional(
        Type.Array(Type.String(), { description: "Category labels (bar charts)" }),
      ),
      x: Type.Optional(
        Type.Array(Type.Number(), { description: "X values for scatter (defaults to 0..n-1)" }),
      ),
      horizontal: Type.Optional(Type.Boolean({ default: false })),
      bins: Type.Optional(Type.Number({ description: "Number of bins for histogram" })),
      height: Type.Optional(Type.Number({ description: "Plot height in rows" })),
      width: Type.Optional(Type.Number({ description: "Plot width in columns" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate) {
      const vals = params.values ?? [];
      const width = params.width ?? 60;
      const height = params.height ?? 20;
      let text: string;
      switch (params.kind) {
        case "bar": {
          const labels = params.labels ?? vals.map((_, i) => String(i));
          text = barChart(vals, labels, {
            horizontal: params.horizontal,
            height: params.height ?? 8,
            width: params.width ?? 40,
          });
          break;
        }
        case "line":
          text = lineChart(vals, width, height);
          break;
        case "scatter": {
          const xs = params.x ?? vals.map((_, i) => i);
          text = scatterPlot(xs, vals, width, height);
          break;
        }
        case "spark":
          text = sparkline(vals, width);
          break;
        case "hist":
          text = histogram(vals, params.bins ?? 10, params.height ?? 8);
          break;
        default:
          text = "(unknown kind)";
      }
      return { content: [{ type: "text", text }], details: {} };
    },
  });

  pi.registerTool({
    name: "diagram",
    label: "Diagram",
    description:
      "Draw an inline architecture/flow diagram (boxes + arrows) or a tree hierarchy. Use for visualizing a codebase's structure, service components, dependencies, or any graph.",
    promptSnippet: "Draw an inline architecture/flow diagram or tree hierarchy",
    promptGuidelines: [
      "Use the diagram tool to visualize a codebase's architecture, a service's components, module dependencies, or a call graph. Derive edges from real code (e.g. imports) rather than guessing.",
      "Use diagram flow for relationships and diagram tree for hierarchies/breakdowns. Keep flow diagrams under ~20 nodes.",
    ],
    parameters: Type.Object({
      kind: StringEnum(["flow", "tree"] as const),
      edges: Type.Optional(
        Type.Array(Type.String(), { description: 'Directed edges like "App -> API"' }),
      ),
      lines: Type.Optional(
        Type.Array(Type.String(), { description: "Indented hierarchy lines (2 spaces per level)" }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate) {
      const text =
        params.kind === "flow"
          ? flowDiagram(parseEdges(params.edges ?? []))
          : treeDiagram(params.lines ?? []);
      return { content: [{ type: "text", text }], details: {} };
    },
  });
}
