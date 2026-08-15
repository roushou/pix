#!/usr/bin/env bun
// frames.ts — draw boxes, frames, dividers, and speech bubbles around text.
//
// Subcommands:
//   box      ┌─title────────┐ box around multi-line text
//   frame    thin border around text
//   divider  ──── text ──── centered horizontal rule
//   bubble   speech bubble with an arrow tail
//
// Text comes from stdin or --text (use \n for newlines). Title via --title.
//
// Examples:
//   echo 'hello' | bun scripts/frames.ts box --title 'pix'
//   bun scripts/frames.ts divider --text 'Section 2'
//   bun scripts/frames.ts bubble --text 'deploy now'

import { readFileSync } from "node:fs";

const TL = "┌";
const TR = "┐";
const BL = "└";
const BR = "┘";
const H = "─";
const V = "│";

interface Opts {
  text?: string;
  title?: string;
  width: number;
}

const USAGE =
  "usage: frames.ts <box|frame|divider|bubble> [--text TEXT] [--title TITLE] [--width N]";

function parseOpts(argv: string[]): Opts {
  const opts: Opts = { width: 60 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--text") opts.text = argv[++i];
    else if (a === "--title") opts.title = argv[++i];
    else if (a === "--width") opts.width = Number.parseInt(argv[++i] ?? "", 10) || 60;
    else if (a === "--help" || a === "-h") {
      console.log(USAGE);
      process.exit(0);
    }
  }
  return opts;
}

function getText(opts: Opts): string[] {
  let text = opts.text;
  if (text === undefined) {
    text = process.stdin.isTTY ? "" : readFileSync(0, "utf8").replace(/\n+$/, "");
  }
  return text.replace(/\\n/g, "\n").split("\n");
}

function box(opts: Opts): void {
  const lines = getText(opts);
  const title = opts.title ?? "";
  const width = Math.max(...lines.map((l) => l.length), title ? title.length + 1 : 0);
  if (title) {
    console.log(`${TL}${H}${title}${H.repeat(width - title.length - 1)}${TR}`);
  } else {
    console.log(`${TL}${H.repeat(width)}${TR}`);
  }
  for (const l of lines) console.log(`${V}${l.padEnd(width)}${V}`);
  console.log(`${BL}${H.repeat(width)}${BR}`);
}

function frame(opts: Opts): void {
  const lines = getText(opts);
  const width = Math.max(...lines.map((l) => l.length));
  console.log(`${TL}${H.repeat(width)}${TR}`);
  for (const l of lines) console.log(`${V}${l.padEnd(width)}${V}`);
  console.log(`${BL}${H.repeat(width)}${BR}`);
}

function divider(opts: Opts): void {
  const text = (opts.text ?? "").replace(/\\n/g, " ").trim();
  const width = opts.width;
  if (text) {
    const left = Math.max(0, Math.floor((width - text.length - 2) / 2));
    const right = Math.max(0, width - text.length - 2 - left);
    console.log(`${H.repeat(left)} ${text} ${H.repeat(right)}`);
  } else {
    console.log(H.repeat(width));
  }
}

function bubble(opts: Opts): void {
  const lines = getText(opts);
  const width = Math.max(...lines.map((l) => l.length));
  console.log(`.${"-".repeat(width + 2)}.`);
  if (lines.length === 1) {
    console.log(`< ${(lines[0] ?? "").padEnd(width)} >`);
  } else {
    console.log(`/ ${(lines[0] ?? "").padEnd(width)} \\`);
    for (const l of lines.slice(1, -1)) console.log(`| ${l.padEnd(width)} |`);
    console.log(`\\ ${(lines[lines.length - 1] ?? "").padEnd(width)} /`);
  }
  console.log(`\`${"-".repeat(width + 2)}'`);
  console.log("        \\");
  console.log("         V");
}

function main(): void {
  const [cmd, ...rest] = process.argv.slice(2);
  const opts = parseOpts(rest);
  switch (cmd) {
    case "box":
      return box(opts);
    case "frame":
      return frame(opts);
    case "divider":
      return divider(opts);
    case "bubble":
      return bubble(opts);
    default:
      console.error(USAGE);
      process.exit(2);
  }
}

main();
