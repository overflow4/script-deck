# Script Deck

A fast, tap-to-copy sales-script tool for DM setters and callers. It mirrors the
team's Google Doc and turns each script into a series of copy-ready boxes — tap a
box, the line is on your clipboard, paste it into the DM or CRM. Built mobile-first.

**Live site:** https://overflow4.github.io/script-deck/

## What it shows

The five scripts from the doc, each as its own tab (DM Script opens first):

- Warm Setting Phone Script
- Cold Setting Phone Script
- Closing Phone Script
- **DM Script (TT, FB, IG)**
- Dominic's Cold Call

Boxes are colour-coded: copper = a line **you send**, muted = what **they say**
(context), dashed = a note, copper pills = links/booking URLs. Fill-in
placeholders like `[Name]`, `(company)`, `firstname` are highlighted so you
remember to swap them before sending.

## How it stays in sync

The site never reads the Google Doc directly from the browser (Google blocks
that, and the doc contains a private PASSWORDS section). Instead:

1. A GitHub Action (`.github/workflows/sync.yml`) runs every ~10 minutes.
2. It fetches the doc's plain-text export server-side and runs `sync/sync.mjs`.
3. The parser (`sync/parse.mjs`) keeps **only** sections whose title contains
   "SCRIPT" — passwords and other internal sections are dropped and never reach
   the public site — and writes `scripts.json`.
4. Committing `scripts.json` redeploys GitHub Pages. Each page reload shows the
   latest synced version.

Edit the Google Doc, wait up to ~10 minutes (or run the workflow manually from
the repo's **Actions** tab → *Sync scripts from Google Doc* → *Run workflow*),
and the site updates.

## Run it locally

```bash
node sync/sync.mjs          # rebuild scripts.json from the doc
npx serve .                 # serve the folder, open index.html
```

## Files

| File | Purpose |
| --- | --- |
| `index.html`, `styles.css`, `app.js` | The static site |
| `scripts.json` | Generated, copy-ready script data (committed; scripts only) |
| `sync/parse.mjs` | Doc-text → structured script parser |
| `sync/sync.mjs` | Fetches the doc export and writes `scripts.json` |
| `.github/workflows/sync.yml` | Scheduled auto-sync |

The doc ID lives in `sync/sync.mjs` (`DOC_ID`). Point it at a different doc by
changing that value or setting the `DOC_ID` env var.
