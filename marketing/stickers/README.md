# Stickers

Six stickers, ready to send to a printer. Every QR code points to `https://dottrader.app/?ref=sticker`
(the `ref` lets you see sticker visits in your analytics) and was checked with two QR readers
(jsQR and ZXing) at print size and at phone-camera sizes.

| File | Kind | Size |
|---|---|---|
| `diecut-logo` | Die-cut: the D with "Dot Trading Post", dottrader.app and a small QR code | 3″ |
| `diecut-scan` | Die-cut: "Scan to swap" card with QR | 3″ |
| `diecut-physical-nft` | Die-cut: "Physical for NFT" burst | 3″ |
| `square-pitch` | Square: "Trade anything for anything", the three ways to swap, QR | 3″ × 3″ |
| `square-scan` | Square: big "Scan to swap" QR | 3″ × 3″ |
| `square-trade-me` | Square: "What would you trade for this?" with write-in I have / I want, QR | 3″ × 3″ |

`preview-sheet.png` shows them all together.

## Ordering

**Die-cut** (Sticker Mule, StickerApp, Stickermule-style sites): upload the `.png`. It has a
transparent background and a white border grown around the artwork, so the site cuts around the
shape automatically. `-cutline.png` shows where the cut falls (the pink line is not printed). Pick
3″ for the size.

**Square**: upload the `.pdf` (or `.png`). The artwork is 3.25″ × 3.25″ including a ⅛″ bleed on every
side, so pick 3″ × 3″ and the printer trims the bleed off. Choose "square" and, if offered, rounded
corners.

Matte vinyl suits the paper-and-ink look; `square-trade-me` needs a writable finish (matte paper or
matte vinyl, not gloss) if people are going to write on it.

## Changing them

`source/build.mjs` makes everything (Node, Playwright and the `qrcode`, `jsqr`, `pngjs` and
`@zxing/library` packages). Edit the designs there and run it again.
