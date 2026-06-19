import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { GraphResizeHandle } from './GraphResizeHandle';

interface PanelCardProps {
  /** Title shown in the slim header bar. */
  label: string;
  /** Remove this panel from the graph stack. */
  onDelete: () => void;
  /** Committed card height (px); seeds the live height. */
  height?: number;
  /** Fallback height when none is committed yet. */
  defaultHeight: number;
  /** Persist a new card height (fired on resize-drag release). */
  onHeightChange?: (height: number) => void;
  children: React.ReactNode;
}

/**
 * A resizable graph-stack card for relocated panels (video / mini-map). Unlike
 * SingleSeriesChart's canvas overlay header, these own complex UI of their own
 * (Leaflet controls, video toolbar) with corner widgets, so the title + remove
 * live in a slim non-overlapping header bar instead of floating on the content.
 */
export function PanelCard({ label, onDelete, height, defaultHeight, onHeightChange, children }: PanelCardProps) {
  const { t } = useTranslation('session');
  const committedHeight = height ?? defaultHeight;
  const [cardHeight, setCardHeight] = useState(committedHeight);
  useEffect(() => { setCardHeight(committedHeight); }, [committedHeight]);

  return (
    <div className="relative border-b border-border flex flex-col" style={{ height: `${cardHeight}px` }}>
      <div className="shrink-0 flex items-center justify-between px-2 py-1 border-b border-border bg-muted/30">
        <span className="text-xs font-mono text-muted-foreground">{label}</span>
        <button
          onClick={onDelete}
          className="p-1 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
          title={t('graphs.removeGraph')}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="relative flex-1 w-full min-h-0 overflow-hidden">
        {children}
      </div>
      <GraphResizeHandle
        height={cardHeight}
        onResize={setCardHeight}
        onCommit={(h) => { setCardHeight(h); onHeightChange?.(h); }}
      />
    </div>
  );
}
