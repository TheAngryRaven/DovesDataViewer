

# Add "Credits" Dialog to Homepage Header

## Overview
Add a "Credits" button to the left of the Sponsor button on the homepage header. Clicking it opens a dialog listing all the open-source technologies and free services the project relies on, each with a link to its homepage/resource.

## Changes

### 1. `src/pages/Index.tsx`
- Import `Dialog`, `DialogTrigger`, `DialogContent`, `DialogHeader`, `DialogTitle` from `@/components/ui/dialog`
- Import an appropriate icon (e.g., `Award` or `BookOpen` from lucide-react)
- Add a "Credits" button to the left of the existing Sponsor `<a>` tag, inside the header's right-side flex container
- The button opens a Dialog containing a styled list of technologies with external links

### Credits List

| Project | URL |
|---------|-----|
| React | https://react.dev |
| Vite | https://vite.dev |
| TypeScript | https://www.typescriptlang.org |
| Tailwind CSS | https://tailwindcss.com |
| shadcn/ui | https://ui.shadcn.com |
| Radix UI | https://www.radix-ui.com |
| Leaflet | https://leafletjs.com |
| OpenStreetMap | https://www.openstreetmap.org |
| Lucide Icons | https://lucide.dev |
| TanStack Query | https://tanstack.com/query |
| IEM ASOS (Iowa State) | https://mesonet.agron.iastate.edu |
| NWS API | https://www.weather.gov/documentation/services-web-api |
| Savitzky-Golay (ml.js) | https://github.com/mljs/savitzky-golay |
| Sonner | https://sonner.emilkowal.dev |
| react-resizable-panels | https://github.com/bvaughn/react-resizable-panels |

### UI Details
- Button: `variant="outline" size="sm"` with a `BookOpen` icon and "Credits" label (label hidden on small screens, same pattern as Sponsor)
- Dialog: dark-themed, scrollable list of links styled as a simple two-column layout (name + link), each opening in a new tab
- A brief thank-you line at the top: "Built on the shoulders of these incredible open-source projects and free services."

### File modified: 1
- `src/pages/Index.tsx`
