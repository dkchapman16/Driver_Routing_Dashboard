# v1.4 UX/Data Update

- Dark theme readability improved; modern surfaces & accent
- Map area widened; left panel compacted
- Timeline given more space (two-column grid) with chips for **Revenue, Miles, RPM, On‑Time**
- Revenue now uses **Hauling Fee** (fallback to **Load Amount**)
- Strict ordering by **Ship Date** (or by **Del. Date** when filter basis switched)
- New **Filter by: Pickup / Delivery** toggle controls whether the date range uses Ship vs Delivery dates
- Playback speed selector (Slow/Normal/Fast) and reliable stepping
- Suppress default Google **A/B** markers to avoid confusion; clean colored polylines instead
- On‑time KPI: any row where **Shipper Arrival Status** or **Receiver Arrival Status** includes “late” counts as NOT on‑time; blank statuses are excluded from the percentage
