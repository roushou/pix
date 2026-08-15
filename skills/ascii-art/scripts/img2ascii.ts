#!/usr/bin/env bun
// img2ascii.ts — convert an image to ASCII/ANSI art in the terminal.
//
// Uses, in order of preference: `chafa`, `jp2a`, `viu`, `img2txt` (libcaca).
// Falls back with an install hint.
//
// Examples:
//   bun scripts/img2ascii.ts logo.png
//   bun scripts/img2ascii.ts photo.jpg --width 80
//   bun scripts/img2ascii.ts photo.jpg --color

import { spawnSync } from "node:child_process";

function tryCli(path: string, width?: number, color = false): boolean {
  const tools: Array<{ cmd: string; base: string[]; widthFlag: boolean }> = [
    {
      cmd: "chafa",
      base: ["--symbols", "block+border+space", "--format", "symbols"],
      widthFlag: false,
    },
    { cmd: "jp2a", base: ["--width"], widthFlag: true },
    { cmd: "viu", base: ["-w"], widthFlag: true },
    { cmd: "img2txt", base: ["-W"], widthFlag: true },
  ];
  for (const t of tools) {
    const argv = [...t.base];
    if (t.widthFlag && width) argv.push(String(width));
    if (t.cmd === "chafa" && width) argv.push("--size", `${width}x`);
    if (t.cmd === "chafa" && color) argv.push("--colors", "full");
    argv.push(path);
    const res = spawnSync(t.cmd, argv, { encoding: "utf8", timeout: 30_000 });
    if (!res.error && res.status === 0 && (res.stdout ?? "").trim()) {
      process.stdout.write(`${(res.stdout ?? "").replace(/\n+$/, "")}\n`);
      return true;
    }
  }
  return false;
}

function main(): void {
  const args = process.argv.slice(2);
  let width: number | undefined;
  let color = false;
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--width") width = Number.parseInt(args[++i] ?? "", 10);
    else if (a === "--color") color = true;
    else if (a === "--help" || a === "-h") {
      console.log("usage: img2ascii.ts [--width N] [--color] IMAGE");
      process.exit(0);
    } else positional.push(a);
  }

  const image = positional[0];
  if (!image) {
    console.error("error: image path required");
    process.exit(2);
  }

  if (tryCli(image, width, color)) return;
  console.error("No image-to-ASCII tool found. Install one of: chafa, jp2a, viu, img2txt.");
  process.exit(1);
}

main();
