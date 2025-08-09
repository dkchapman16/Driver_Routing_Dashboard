# Driver Route Map App

An interactive web app to visualize driver routes on Google Maps from your load spreadsheet.

## Features
- Upload Excel/CSV with your 2025 columns
- Select a driver and date range
- Routes drawn Shipper → Receiver in chronological order
- Lane color-coding (each lane gets a unique color)
- Marker clustering for origins/destinations
- Playback animation (reveal legs one by one)
- Traffic layer toggle

## Quick Start
```bash
npm i
npm run dev
```

Optionally create `.env`:
```
VITE_GOOGLE_MAPS_API_KEY=YOUR_KEY
```

## Build
```bash
npm run build
```

Deploy the `dist/` folder to Vercel/Netlify or any static host.


## Hosting

### Option A — Vercel (recommended)
1. Create a new GitHub repo and push this project.
2. In Vercel, **Import Project** from your repo.
3. Add Environment Variables (Project Settings → Environment Variables):
   - `VITE_GOOGLE_MAPS_API_KEY` = your browser API key
4. Build & deploy. Vercel will auto-redeploy on every push to `main`.

*CI Alternative:* Use `.github/workflows/vercel-deploy.yml` with GitHub secrets:
- `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, and optionally `VITE_GOOGLE_MAPS_API_KEY`

### Option B — GitHub Pages
1. Push to GitHub.
2. In repo Settings → Pages, set **Source** to **GitHub Actions**.
3. The workflow `.github/workflows/pages.yml` builds and publishes `dist/` automatically on push to `main`.
4. Open the URL it prints in the workflow logs.

> The app does **not** require server-side secrets. You can paste the API key in the UI if you don’t want it in repo/CI.
