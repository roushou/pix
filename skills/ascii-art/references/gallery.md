# ASCII Art — gallery

Examples of each tool's output.

## Banner (built-in 5x7 font)

```bash
python3 scripts/banner.py 'pix'
```

```
█████  ███  █   █
█   █   █   █ █
█████   █    █
█       █   █ █
█      ███  █   █
```

(with `figlet`/`toilet` installed, many more fonts are available via `--font`)

## Image → ASCII

```bash
python3 scripts/img2ascii.py logo.png --width 40
```

```
          .:;irsXA253hMHGS#9B&@
      .:irshMHGS#9B&@
    :sX25hMHGS#9B&@
   .sA25hMHGS#9B&@
```

## Box with title

```bash
echo 'hello' | python3 scripts/frames.py box --title 'pix'
```

```
┌─pix───┐
│ hello │
└───────┘
```

## Divider

```bash
python3 scripts/frames.py divider --text 'Section 2'
```

```
──────────────────────── Section 2 ─────────────────────────
```

## Speech bubble

```bash
python3 scripts/frames.py bubble --text 'deploy now'
```

```
 ┌─────────────┐
 < deploy now  >
 └─────────────┘
        \
         V
```

## Pure-ASCII fallback (for comments/emails)

```bash
python3 scripts/banner.py 'OK' --char '#'
```

```
 ####  #  #
#    # # #
#    # ##
#    # # #
 ####  #  #
```
