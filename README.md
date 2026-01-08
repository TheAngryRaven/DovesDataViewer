# Dove's DataViewer

**Open source motorsport data acquisition and analytics**

🌐 **Live Demo:** [HackTheTrack.net](https://hackthetrack.net)  
🔧 **Hardware Project:** [DovesDataLogger on GitHub](https://github.com/DovesDataLogger)

---

## Philosophy

This project is **100% open source**. The entire codebase—every feature, every parser, every visualization—is freely available for anyone to use, modify, and self-host.

- **Local Processing:** All data analysis happens in your browser. Your telemetry data never leaves your device.
- **No Server Required:** No uploads, no database, no accounts, no cloud sync.
- **Team Transparency:** Organizations can audit the code themselves for security compliance.

## Free Forever

- **Single file processing on HackTheTrack.net is always free**—no download or account required
- **Self-hosting is always an option**—clone this repo and run it yourself
- The only potential future paid feature: optional cloud storage for users who *want* hosted data retention on my infrastructure

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
| Backend | **None** – zero server dependencies |

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
│   ├── RaceLineView.tsx
│   ├── TelemetryChart.tsx
│   └── ...
├── lib/             # Parsers and utilities
│   ├── nmeaParser.ts
│   ├── ubxParser.ts
│   ├── vboParser.ts
│   ├── doveParser.ts
│   ├── alfanoParser.ts
│   ├── aimParser.ts
│   └── ...
├── pages/           # Route pages
└── types/           # TypeScript definitions
```

---

## License

See [LICENSE](./LICENSE) for details.
