#!/usr/bin/env python3
"""img2ascii.py — convert an image to ASCII/ANSI art in the terminal.

Uses, in order of preference: `chafa`, `jp2a`, `viu`, `img2txt` (libcaca),
then Pillow. Falls back gracefully with an install hint.

Examples:
  python3 img2ascii.py logo.png
  python3 img2ascii.py photo.jpg --width 80
  python3 img2ascii.py photo.jpg --color
"""

import argparse
import shutil
import subprocess
import sys

RAMP = " .,:;irsXA253hMHGS#9B&@"


def try_cli(path, args):
    commands = [
        (["chafa", "--symbols", "block+border+space", "--format", "symbols"], {}),
        (["jp2a", "--width"], {"width": True}),
        (["viu", "-w"], {"width": True}),
        (["img2txt", "-W"], {"width": True}),
    ]
    for cmd, opts in commands:
        exe = shutil.which(cmd[0])
        if not exe:
            continue
        argv = list(cmd)
        if opts.get("width") and args.width:
            argv += [str(args.width)]
        if cmd[0] == "chafa" and args.width:
            argv += ["--size", f"{args.width}x"]
        if cmd[0] == "chafa" and args.color:
            argv += ["--colors", "full"]
        argv.append(path)
        try:
            out = subprocess.run(argv, capture_output=True, text=True, timeout=30)
            if out.returncode == 0 and out.stdout.strip():
                print(out.stdout.rstrip("\n"))
                return True
        except Exception:
            continue
    return False


def try_pillow(path, args):
    try:
        from PIL import Image
    except ImportError:
        return False
    img = Image.open(path).convert("L")
    width = args.width or 80
    aspect = img.height / img.width * 0.5  # chars are ~2x tall
    height = max(1, int(width * aspect))
    img = img.resize((width, height))
    px = img.load()
    out = []
    for y in range(height):
        row = []
        for x in range(width):
            v = px[x, y]
            row.append(RAMP[v * (len(RAMP) - 1) // 255])
        out.append("".join(row))
    print("\n".join(out))
    return True


def main():
    p = argparse.ArgumentParser(description="Convert an image to ASCII art")
    p.add_argument("image", help="path to image file")
    p.add_argument("--width", type=int, default=None, help="output width in characters")
    p.add_argument("--color", action="store_true", help="preserve color (chafa only)")
    args = p.parse_args()

    if try_cli(args.image, args):
        return
    if try_pillow(args.image, args):
        return
    print(
        "No image-to-ASCII tool found. Install one of: chafa, jp2a, viu, img2txt "
        "(or Pillow: pip install Pillow).",
        file=sys.stderr,
    )
    sys.exit(1)


if __name__ == "__main__":
    main()
