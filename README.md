# Driver Routing Dashboard – v1.5 Patch

**What’s new**

- Dark theme readability (no white boxes), modern cards, lime accent (#D2F000).
- Bigger map (left panel narrower), roomier two‑column timeline.
- Revenue pulled from **Hauling Fee**.
- **RPM** shown as **Hauling Fee / Miles** (two decimals).
- Strict chronological sort by **Ship Date** (fallback: Delivery).
- Date filter **basis** toggle: **Pickup (Ship Date)** or **Delivery (Del. Date)**.
- Playback fixed with speed control (Slow/Normal/Fast), ordered steps.
- On‑Time% counts as on‑time when **neither** Shipper nor Receiver Arrival Status contains “late”.
- Canceled loads filtered by `Load Status`.

**How to apply**

1. In GitHub, open your repo → **Add file → Upload files**.
2. Upload these two files from this ZIP, replacing existing ones:
   - `src/App.jsx`
   - `README.md`
3. Commit to `main`. Vercel will redeploy automatically (or click **Redeploy**).

