# Dove's DataViewer

**Open source motorsport data acquisition and analytics**

🌐 **Live Demo:** [HackTheTrack.net](https://hackthetrack.net)  
🔧 **Hardware Project:** [DovesDataLogger on GitHub](https://github.com/TheAngryRaven/DovesDataLogger)

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
| State | React Query |
| Backend | **None** – zero server dependencies (optional admin backend via Lovable Cloud) |

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

> **Note:** `TURNSTILE_SECRET_KEY` is a server-side secret stored in Lovable Cloud, not a `VITE_` client variable. If not set, Turnstile verification is skipped.

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
- **Tools** — Build `tracks.json` from DB, download tracks ZIP (per-track files), import JSON to rebuild DB
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
