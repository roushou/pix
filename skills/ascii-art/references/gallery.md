# ASCII Art — gallery

Examples of each tool's output.

## Banner (built-in 5x7 font)

```bash
bun scripts/banner.ts 'pix'
```

```
████  █████ █   █
█   █   █   █   █
█   █   █    █ █
████    █     █
█       █    █ █
█       █   █   █
█     █████ █   █
```

(with `figlet`/`toilet` installed, many more fonts are available via `--font`)

## Image → ASCII

```bash
bun scripts/img2ascii.ts logo.png --width 40
```

Uses `chafa` (block art, best), then `jp2a`, `viu`, `img2txt` — output varies by
which tool is installed. With none installed, it prints an install hint instead.

## Box with title

```bash
echo 'hello' | bun scripts/frames.ts box --title 'pix'
```

```
┌─pix─┐
│hello│
└─────┘
```

## Divider

```bash
bun scripts/frames.ts divider --text 'Section 2'
```

```
──────────────────────── Section 2 ─────────────────────────
```

## Speech bubble

```bash
bun scripts/frames.ts bubble --text 'deploy now'
```

```
.------------.
< deploy now >
`------------'
        \
         V
```

## Pure-ASCII fallback (for comments/emails)

```bash
bun scripts/banner.ts 'OK' --char '#'
```

```
 ###  #   #
#   # #  #
#   # # #
#   # ##
#   # # #
#   # #  #
 ###  #   #
```
