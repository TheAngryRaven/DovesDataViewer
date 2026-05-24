# Dove's DataViewer


**Open source motorsport data acquisition and analytics**

[![Lint](https://github.com/TheAngryRaven/DovesDataViewer/actions/workflows/lint.yml/badge.svg)](https://github.com/TheAngryRaven/DovesDataViewer/actions/workflows/lint.yml)
[![Typecheck](https://github.com/TheAngryRaven/DovesDataViewer/actions/workflows/typecheck.yml/badge.svg)](https://github.com/TheAngryRaven/DovesDataViewer/actions/workflows/typecheck.yml)
[![Test](https://github.com/TheAngryRaven/DovesDataViewer/actions/workflows/test.yml/badge.svg)](https://github.com/TheAngryRaven/DovesDataViewer/actions/workflows/test.yml)
[![Build](https://github.com/TheAngryRaven/DovesDataViewer/actions/workflows/build.yml/badge.svg)](https://github.com/TheAngryRaven/DovesDataViewer/actions/workflows/build.yml)
[![Coverage](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/TheAngryRaven/DovesDataViewer/badges/coverage-badge.json)](https://github.com/TheAngryRaven/DovesDataViewer/actions/workflows/coverage.yml)

🌐 **Live Demo:** [HackTheTrack.net](https://hackthetrack.net)  
🔧 **Hardware Project:** [DovesDataLogger on GitHub](https://github.com/TheAngryRaven/DovesDataLogger)

---

<p align="center">
  <img src="preview.jpg" />
</p>

---

## Features

- Multi-format file support (NMEA, UBX, VBO, MoTeC, AiM, Alfano, Dove, Dovex)
- Automatic track & course detection within 5 miles
- Automatic driving direction detection (forward/reverse)
- Waypoint mode — lap timing anywhere, no track needed
- Interactive race line map with speed heatmap
- Braking zone detection & visualization
- Automatic lap detection via start/finish line
- 3-sector split timing with optimal lap
- Pro graph view with multi-series telemetry charts
- Reference lap overlay & pace delta comparison
- Video sync with telemetry playback
- 9 overlay gauge types (digital, analog, graph, bar, bubble, map, pace, sector, lap time)
- MP4 video export with overlays & audio (H.264 + AAC)
- Vehicle profiles & setup sheet management
- Session notes per file
- BLE device integration (DovesDataLogger)
- Device track sync over Bluetooth
- Custom track & course editor with community submissions
- Local weather lookup
- Dark & light mode
- PWA — installable & fully offline

---

## Philosophy

This project is **100% open source**. The entire codebase—every feature, every parser, every visualization—is freely available for anyone to use, modify, and self-host.

- **Local Processing:** All data analysis happens in your browser. Your telemetry data never leaves your device.
- **No Server Required:** No uploads, no database, no accounts, no cloud sync.
- **Team Transparency:** Organizations can audit the code themselves for security compliance.

## Free Forever

- **Single file processing on HackTheTrack.net is always free**—no download or account required
- **Self-hosting is always an option**—clone this repo and run it yourself
- The only potential future paid feature: optional cloud storage for users who *want* hosted data retention on *my* infrastructure

---

## Supported File Formats

All formats are auto-detected on import:

| Format | Source | Extension |
|--------|--------|-----------|
| UBX Binary | u-blox GPS receivers | `.ubx` |
| VBO | Racelogic VBOX, RaceBox | `.vbo` |
| Dove CSV | DovesDataLogger | `.dove` |
| Dovex | DovesDataLogger (extended with metadata) | `.dovex` |
| Alfano CSV | Alfano ADA app, Off Camber Data | `.csv` |
| AiM CSV | MyChron 5/6, Race Studio 3 | `.csv` |
| MoTeC CSV | MoTeC i2 Pro export | `.csv` |
| MoTeC LD | MoTeC native binary | `.ld` |
| NMEA | Standard GPS sentences | `.nmea`, `.txt`, `.csv` |

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | React 18 + TypeScript |
| Build | Vite |
| Styling | Tailwind CSS + shadcn/ui |
| Mapping | Leaflet (OpenStreetMap) |
| Charts | Custom Canvas 2D renderer |
| Video Export | WebCodecs + [mp4-muxer](https://github.com/Vanilagy/mp4-muxer) (H.264 MP4) |
| State | React Query |
| Backend | **None** – zero server dependencies (optional admin backend via Lovable Cloud) |
| BLE | Web Bluetooth API for DovesDataLogger device communication & settings |

---

## Admin Panel & Track Database (Optional)

The app includes an optional admin system for managing a community track database. When enabled, users can submit new tracks/courses for review, and admins can manage everything through a web interface.

**The app always reads tracks from `public/tracks.json` — zero database calls on normal page loads.** The database exists solely for the admin workflow.

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_SUPABASE_URL` | Yes (if using Cloud) | Backend URL (auto-set by Lovable Cloud) |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Yes (if using Cloud) | Backend public/anon key (auto-set by Lovable Cloud) |
| `VITE_SUPABASE_PROJECT_ID` | Yes (if using Cloud) | Backend project ID (auto-set by Lovable Cloud) |
| `VITE_ENABLE_ADMIN` | No | Set to `true` to enable admin UI and `/login` route |
| `VITE_ENABLE_REGISTRATION` | No | Set to `true` to enable the `/register` route |
| `VITE_TURNSTILE_SITE_KEY` | No | Cloudflare Turnstile site key for track submission CAPTCHA |
| `TURNSTILE_SECRET_KEY` | No | Cloudflare Turnstile secret key (edge function secret — `???`) |
| `DOVE_PLUGIN_PACKAGES` | No | Build-time: comma-separated external plugin npm packages to load. Overrides the default (`@perchwerks/eye-in-the-sky`, the public AI coach) when set |

> **Note:** `TURNSTILE_SECRET_KEY` is a server-side secret stored in Lovable Cloud, not a `VITE_` client variable. If not set, Turnstile verification is skipped.

> **Note:** `DOVE_PLUGIN_PACKAGES` is build-time only (read by `vite.config.ts`), not a client `VITE_` variable. It overrides which external plugin packages the build loads; by default the build pulls in the public AI coach (`@perchwerks/eye-in-the-sky`) from npm as an optional dependency — see `src/plugins/README.md`.

> **Build fallback:** `vite.config.ts` now hardcodes the project's public backend URL, publishable key, and project ID as a fallback for production builds. Local `.env` values still take precedence, but published builds no longer white-screen if managed env injection is temporarily missing.

> **PWA cache recovery:** the legacy `/sw.js` path now ships a one-release cleanup worker that deletes old app caches and unregisters itself without touching IndexedDB telemetry/session data. The active offline worker is now published at `/service-worker.js`, and HTML navigations use `NetworkFirst` to reduce the chance of users getting stuck on an old shell after future deploys.

### Database Setup

The admin system uses Lovable Cloud (Supabase) for the database. The schema is created automatically via migrations. Tables:

- **tracks** — Track names with short names (max 8 chars) and enabled flag
- **courses** — Course definitions with start/finish and optional sector lines
- **submissions** — User-submitted tracks/courses pending admin review
- **banned_ips** — IP addresses blocked from submissions
- **login_attempts** — Rate limiting for login (5 attempts, 1 hour lockout)
- **user_roles** — Admin/user role assignments (uses `has_role()` security definer)

### Modular Database Layer

All database code lives behind `src/lib/db/` with a clean interface (`ITrackDatabase`). The current implementation uses Supabase, but you can swap in PostgreSQL/MySQL by implementing the same interface:

```
src/lib/db/
  types.ts            — Interface definitions
  supabaseAdapter.ts  — Supabase implementation  
  index.ts            — Factory: getDatabase()
```

### Admin Features

- **Submissions** — Approve/deny user-submitted tracks and courses
- **Tracks CRUD** — Add, edit, enable/disable, delete tracks (with short names)
- **Courses CRUD** — Manage courses per track with coordinate editing
- **Tools** — Build `tracks.json` from DB, download tracks ZIP, import JSON to rebuild DB, export/import course drawings
- **Banned IPs** — View and manage banned IP addresses

### Edge Functions

| Function | Purpose |
|----------|---------|
| `submit-track` | Public endpoint for track submissions (with IP ban check) |
| `admin-build-zip` | Admin-only: generates per-track JSON files |
| `check-login-rate` | Rate limiting for login attempts |

### Track Short Names

Every track has a `short_name` (max 8 characters) used for:
- ZIP export filenames (`OKC.json`)
- Compact UI display in the header
- Falls back to `abbreviateTrackName()` for tracks without a short name

### First-Time Setup

1. Enable Lovable Cloud
2. Run the database migration (automatic)
3. Create an admin user via the auth system
4. Add the admin role: `INSERT INTO user_roles (user_id, role) VALUES ('<your-user-id>', 'admin');`
5. Set `VITE_ENABLE_ADMIN=true`

---

## Local Development

### Prerequisites

- Node.js 18+ (or [Bun](https://bun.sh))

### Installation

```bash
# Clone the repository
git clone https://github.com/your-username/doves-dataviewer.git
cd doves-dataviewer

# Install dependencies
npm install
# or: bun install

# Start development server
npm run dev
# or: bun dev
```

Open [http://localhost:8080](http://localhost:8080) in your browser.

### Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server on port 8080 |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Preview production build locally |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Type-check via `tsc -b` (build mode — follows project references) |
| `npm test` | Run Vitest in watch mode |
| `npm run test:run` | Run Vitest once (CI-style) |

---

## Project Structure

```
src/
├── components/       # React components
│   ├── ui/          # shadcn/ui base components
│   ├── admin/       # Admin panel tabs
│   ├── RaceLineView.tsx
│   ├── TelemetryChart.tsx
│   └── ...
├── lib/             # Parsers and utilities
│   ├── db/          # Modular database layer
│   ├── nmeaParser.ts
│   ├── ubxParser.ts
│   ├── vboParser.ts
│   ├── doveParser.ts
│   ├── alfanoParser.ts
│   ├── aimParser.ts
│   ├── motecParser.ts
│   └── ...
├── hooks/           # React hooks
├── pages/           # Route pages
└── types/           # TypeScript definitions
```

---

## Contributing

Contributions are welcome — new parsers, bug fixes, overlays, and reusability
rewrites especially. See **[CONTRIBUTING.md](CONTRIBUTING.md)** for dev setup,
coding conventions, how to add a new parser, and the PR checklist.

By participating you agree to abide by our Code of Conduct (`CODE_OF_CONDUCT.md`).

Found a security issue? Please follow the disclosure process in
**[SECURITY.md](SECURITY.md)** rather than opening a public issue.

Release history is tracked in **[CHANGELOG.md](CHANGELOG.md)**.

---

## Credits

Built on the shoulders of these incredible open-source projects and free services:

- [React](https://react.dev) · [Vite](https://vite.dev) · [TypeScript](https://www.typescriptlang.org)
- [Tailwind CSS](https://tailwindcss.com) · [shadcn/ui](https://ui.shadcn.com) · [Radix UI](https://www.radix-ui.com) · [Lucide Icons](https://lucide.dev)
- [Leaflet](https://leafletjs.com) · [OpenStreetMap](https://www.openstreetmap.org)
- [TanStack Query](https://tanstack.com/query) · [Sonner](https://sonner.emilkowal.dev) · [react-resizable-panels](https://github.com/bvaughn/react-resizable-panels)
- [mp4-muxer](https://github.com/Vanilagy/mp4-muxer) · [Savitzky-Golay (ml.js)](https://github.com/mljs/savitzky-golay) · [JSZip](https://stuk.github.io/jszip) · [fix-webm-duration](https://github.com/yusitnikov/fix-webm-duration)
- [IEM ASOS (Iowa State)](https://mesonet.agron.iastate.edu) · [NWS API](https://www.weather.gov/documentation/services-web-api)
- [MoTeC i2](https://www.motec.com.au) (file format reference)

Optional admin backend powered by [Supabase](https://supabase.com) via Lovable Cloud.

---

## License

Licensed under the **GNU General Public License v3.0 (or later)** — see
**[LICENSE](LICENSE)**. You are free to use, modify, and self-host; derivative
works that you distribute must also be released under the GPL.
