#!/usr/bin/env python3
"""frames.py — draw boxes, frames, dividers, and speech bubbles around text.

Subcommands:
  box      ┌─title────────┐ box around multi-line text
  frame    thin border around text
  divider  ──── text ──── centered horizontal rule
  bubble   speech bubble with an arrow tail

Text comes from stdin or --text (use \\n for newlines). Title via --title.

Examples:
  echo 'hello' | python3 frames.py box --title 'pix'
  python3 frames.py divider --text 'Section 2'
  python3 frames.py bubble --text 'deploy now'
"""

import argparse
import sys

TL, TR, BL, BR, H, V = "┌", "┐", "└", "┘", "─", "│"


def get_text(args):
    text = args.text
    if text is None:
        text = sys.stdin.read().rstrip("\n") if not sys.stdin.isatty() else ""
    return text.replace("\\n", "\n").splitlines()


def box(args):
    lines = get_text(args)
    if not lines:
        lines = [""]
    title = args.title or ""
    width = max([len(l) for l in lines] + ([len(title) + 1] if title else [0]))
    if title:
        print(f"{TL}{H}{title}{H * (width - len(title) - 1)}{TR}")
    else:
        print(f"{TL}{H * width}{TR}")
    for l in lines:
        print(f"{V}{l:<{width}}{V}")
    print(f"{BL}{H * width}{BR}")


def frame(args):
    lines = get_text(args)
    if not lines:
        lines = [""]
    width = max(len(l) for l in lines)
    print(f"{TL}{H * width}{TR}")
    for l in lines:
        print(f"{V}{l:<{width}}{V}")
    print(f"{BL}{H * width}{BR}")


def divider(args):
    text = (args.text or "").replace("\\n", " ").strip()
    width = args.width
    if text:
        left = max(0, (width - len(text) - 2) // 2)
        right = max(0, width - len(text) - 2 - left)
        print(f"{H * left} {text} {H * right}")
    else:
        print(H * width)


def bubble(args):
    lines = get_text(args)
    if not lines:
        lines = [""]
    width = max(len(l) for l in lines)
    print(f".{'-' * (width + 2)}.")
    if len(lines) == 1:
        print(f"< {lines[0]:<{width}} >")
    else:
        print(f"/ {lines[0]:<{width}} \\")
        for l in lines[1:-1]:
            print(f"| {l:<{width}} |")
        print(f"\\ {lines[-1]:<{width}} /")
    print(f"`{'-' * (width + 2)}'")
    print("        \\")
    print("         V")


def main():
    p = argparse.ArgumentParser(description="ASCII boxes, frames, dividers, bubbles")
    sub = p.add_subparsers(dest="cmd", required=True)
    for name in ("box", "frame", "bubble"):
        sp = sub.add_parser(name)
        sp.add_argument("--text")
        sp.add_argument("--title", default=None)
        sp.set_defaults(func=globals()[name])
    d = sub.add_parser("divider")
    d.add_argument("--text")
    d.add_argument("--width", type=int, default=60)
    d.set_defaults(func=divider)

    args = p.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
