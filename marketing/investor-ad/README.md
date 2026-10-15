# Investor ad

A 42-second motion piece in the Dot brand, 1920×1080, silent (add a music bed in any editor).

- `ad.html` — the animation. Open it in a browser to watch it loop. Every frame is drawn by
  `render(t)`, so edit the words or timings there.
- `render.mjs` — steps it frame by frame into `out/dot-investor-ad.mp4`. `--stills` writes PNGs of
  key moments to `out/` instead.

```
FFMPEG=/path/to/ffmpeg node marketing/investor-ad/render.mjs
```

Needs Playwright and ffmpeg (`npm i ffmpeg-static` anywhere gives you one). Fonts are fetched from
Google Fonts into `fonts/` on the first run.

Every claim in it is true as of October 2026: competitor fees are their published rates (eBay 13.25%
on trading cards, Poshmark 20%, Mercari 10% seller fee), and Dot's fees are the ones in the terms.
There are no traction numbers in it; add them when they say something.
