# Marine Intelligence Web MVP

React + Vite + TypeScript MVP for fishing weather, current, rules, warnings,
bluewater/SST, albacore scoring, saved spots, route checks, and trip briefs.

## Run

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Data

The app is designed for GitHub Pages, so the frontend only reads static files
from `public/data`. `scripts/update_data.py` is the placeholder entry point for
future official-source fetchers.

Current files:

- `public/data/manifest.json`
- `public/data/forecasts.json`
- `public/data/rules.json`
- `public/data/warnings.geojson`
- `public/data/pfma.geojson`
- `public/data/albacore.geojson`
- `public/data/bluewater.json`

This demo data is not for navigation or legal fishing decisions. Always verify
official rules, notices, and marine forecasts before departure.
