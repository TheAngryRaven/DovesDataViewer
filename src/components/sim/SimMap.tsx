/**
 * SimMap — the map above the sim panel (plan 0010, Phase B).
 *
 * Deliberately lean: session path polyline, the detected course's
 * start/finish line, and the playback cursor arrow — driven by the SAME
 * virtual clock as the firmware (the playback engine's cursor), so the
 * marker, the sim display and the scrubber can never disagree. Reuses
 * the shared position-arrow helper and the app's tile styles; none of
 * the heatmap/overlay machinery of the full RaceLineView belongs here.
 */

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import L from "leaflet";
import { Moon, Satellite } from "lucide-react";
import { Button } from "@/components/ui/button";
import { updatePositionMarker } from "@/components/map/positionArrowMarker";
import type { Course, GpsSample } from "@/types/racing";
import "leaflet/dist/leaflet.css";

const TILE_STYLES = {
  dark: {
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attribution: "&copy; CARTO",
  },
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "&copy; Esri",
  },
} as const;

type TileStyle = keyof typeof TILE_STYLES;

export interface SimMapProps {
  samples: GpsSample[];
  course: Course | null;
  /** Index of the sample at the playback cursor (-1 during pre-roll). */
  positionIndex: number;
}

export function SimMap({ samples, course, positionIndex }: SimMapProps) {
  const { t } = useTranslation("simulator");
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tilesRef = useRef<L.TileLayer | null>(null);
  const pathRef = useRef<L.Polyline | null>(null);
  const startFinishRef = useRef<L.Polyline | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const [style, setStyle] = useState<TileStyle>("dark");

  // Map + static layers; rebuilt when the session (or course) changes.
  useEffect(() => {
    if (!containerRef.current || samples.length === 0) return;

    const map = L.map(containerRef.current, {
      zoomControl: true,
      attributionControl: true,
    });
    mapRef.current = map;

    const coords = samples.map((s) => [s.lat, s.lon] as [number, number]);
    pathRef.current = L.polyline(coords, {
      color: "hsl(180, 70%, 55%)",
      weight: 3,
      opacity: 0.75,
    }).addTo(map);
    map.fitBounds(pathRef.current.getBounds(), { padding: [24, 24] });

    if (course) {
      startFinishRef.current = L.polyline(
        [
          [course.startFinishA.lat, course.startFinishA.lon],
          [course.startFinishB.lat, course.startFinishB.lon],
        ],
        { color: "hsl(0, 84%, 60%)", weight: 4, opacity: 0.9 },
      ).addTo(map);
    }

    return () => {
      markerRef.current = null;
      startFinishRef.current = null;
      pathRef.current = null;
      tilesRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, [samples, course]);

  // Tile layer follows the style toggle.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    tilesRef.current?.remove();
    const cfg = TILE_STYLES[style];
    tilesRef.current = L.tileLayer(cfg.url, {
      attribution: cfg.attribution,
      maxZoom: 19,
    }).addTo(map);
  }, [style, samples, course]);

  // Cursor arrow: one marker, moved per position tick (shared helper).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markerRef.current = updatePositionMarker(
      map, markerRef.current, samples, positionIndex,
    );
  }, [samples, positionIndex]);

  if (samples.length === 0) return null;

  return (
    <div className="relative overflow-hidden rounded-lg border border-border">
      <div ref={containerRef} className="h-64 w-full sm:h-80" />
      <div className="absolute right-2 top-2 z-[1000]">
        <Button
          size="sm"
          variant="secondary"
          className="h-8 px-2"
          onClick={() => setStyle(style === "dark" ? "satellite" : "dark")}
          aria-label={t("map.toggleStyle")}
        >
          {style === "dark"
            ? <Satellite className="h-4 w-4" />
            : <Moon className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}
