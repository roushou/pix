---
name: ascii-art
description: Generate ASCII and Unicode art in the terminal — figlet-style text banners, image-to-ASCII conversion, framed boxes, dividers, and speech bubbles. Use whenever the user asks for ASCII art, a text banner, a big header, "convert this image to ascii", or decorative terminal output, even if they don't say "ascii art" explicitly (e.g. "make a big logo", "banner for my readme").
---

# ASCII Art

Produce ASCII/Unicode art in the terminal. Three zero-dependency scripts (banner falls back to a built-in font, so it always works):

- `banner.py` — large text banners (figlet/toilet when available, built-in 5x7 block font otherwise)
- `img2ascii.py` — convert an image to ASCII/ANSI art
- `frames.py` — boxes, frames, dividers, speech bubbles

## Workflow

1. **Pick the form.** Text banner → `banner.py`. Image → `img2ascii.py`. Decoration around text → `frames.py`.
2. **Render to stdout** and include the result in your reply inside a fenced code block so spacing is preserved.
3. **Keep it legible.** Limit width (defaults are sane); don't dump a huge image at full resolution.

## banner.py — text banners

```bash
python3 scripts/banner.py 'pix'
python3 scripts/banner.py 'deploy' --char '#'   # pure ASCII fill
echo 'release' | python3 scripts/banner.py
```

Prefers `figlet`/`toilet` if installed (`brew install figlet toilet`) for many
fonts (`--font big`, `--font shadow`, …); otherwise falls back to the built-in
5x7 block font (uppercase, digits, and common symbols).

## img2ascii.py — image to ASCII

```bash
python3 scripts/img2ascii.py logo.png
python3 scripts/img2ascii.py photo.jpg --width 60
python3 scripts/img2ascii.py photo.jpg --width 80 --color
```

Uses `chafa` (best, `brew install chafa`), then `jp2a`/`viu`/`img2txt`, then
Pillow as a last resort. Grayscale by default; `--color` only with chafa.

## frames.py — boxes, dividers, bubbles

```bash
echo 'hello' | python3 scripts/frames.py box --title 'pix'
python3 scripts/frames.py divider --text 'Section 2'
python3 scripts/frames.py bubble --text 'deploy now'
```

## Rules

- **Preserve spacing** — put ASCII art in a fenced code block, never inline prose.
- **Use Unicode box-drawing and blocks** (`┌─┐ │ └┘ █ ▁▂▃`) for elegance; fall back to `#`, `-`, `|` only when the target is plain-ASCII (e.g. source comments, emails).
- **Keep width ≤ 80** unless the user's terminal is wider.
- **No color by default** — captured tool output is safer in monochrome.

See [references/gallery.md](references/gallery.md) for examples of each output.
