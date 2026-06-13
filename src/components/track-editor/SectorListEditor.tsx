import { useMemo } from 'react';
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor,
  useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Flag, GripVertical, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { CourseSector, Course } from '@/types/racing';
import {
  sectorLabels, validateCourseSectors, isAtSectorLimit, MAX_SECTOR_LINES,
} from '@/lib/courseSectors';
import type { SelectedLine } from '@/hooks/useTrackEditorForm';

interface SectorListEditorProps {
  /** The course being edited (start/finish + sectors) — for labels + validation. */
  course: Course;
  sectors: CourseSector[];
  selectedLine: SelectedLine;
  onSelectLine: (id: SelectedLine) => void;
  onAddSector: (insertIndex?: number) => void;
  onRemoveSector: (index: number) => void;
  onToggleMajor: (index: number) => void;
  onReorder: (from: number, to: number) => void;
}

function sortableId(index: number): string {
  return `sector-${index}`;
}
function indexFromId(id: string): number {
  return Number(id.replace('sector-', ''));
}

export function SectorListEditor({
  course, sectors, selectedLine, onSelectLine, onAddSector, onRemoveSector, onToggleMajor, onReorder,
}: SectorListEditorProps) {
  const labels = useMemo(() => sectorLabels(course), [course]);
  const validation = useMemo(() => validateCourseSectors(course), [course]);
  const atLimit = isAtSectorLimit(course);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const ids = useMemo(() => sectors.map((_, i) => sortableId(i)), [sectors]);

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    onReorder(indexFromId(String(active.id)), indexFromId(String(over.id)));
  };

  // The "+" button after the start/finish header — only when SF has no leading
  // sub-sectors of its own (i.e. the first sector is a major, or the list is empty).
  const sfHasOwnAddSlot = sectors.length === 0 || sectors[0].major;

  const addButton = (insertIndex: number, key: string) => (
    <div key={key} className="pl-7">
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        disabled={atLimit}
        onClick={() => onAddSector(insertIndex)}
      >
        <Plus className="w-3.5 h-3.5" />
        Add sector
      </Button>
    </div>
  );

  return (
    <div className="space-y-1.5">
      {/* Start/finish — always sector 1, always major, fixed. */}
      <button
        type="button"
        onClick={() => onSelectLine('sf')}
        className={cn(
          'flex w-full items-center gap-2 rounded-md border px-2 py-2 text-left transition-colors',
          selectedLine === 'sf' ? 'border-primary bg-primary/10' : 'border-border bg-card hover:bg-accent/40',
        )}
      >
        <span className="w-4" />
        <Flag className="h-4 w-4 shrink-0" style={{ color: '#22c55e' }} />
        <span className="flex-1 text-sm font-semibold">Start/finish (Sector {labels[0]})</span>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Major</span>
      </button>

      {sfHasOwnAddSlot && addButton(0, 'add-sf')}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {sectors.map((sec, i) => {
            const isLastInGroup = i === sectors.length - 1 || sectors[i + 1].major;
            return (
              <div key={sortableId(i)} className="space-y-1.5">
                <SectorRow
                  index={i}
                  label={labels[i + 1] ?? ''}
                  sector={sec}
                  selected={selectedLine === i}
                  onSelect={() => onSelectLine(i)}
                  onToggleMajor={() => onToggleMajor(i)}
                  onRemove={() => onRemoveSector(i)}
                />
                {isLastInGroup && addButton(i + 1, `add-${i}`)}
              </div>
            );
          })}
        </SortableContext>
      </DndContext>

      {/* Validation / guidance note (kept off the line items per the spec). */}
      {!validation.valid && validation.reason && (
        <p className="pt-1 text-xs text-warning">{validation.reason}</p>
      )}
      {atLimit && (
        <p className="pt-1 text-xs text-muted-foreground">
          Sector limit reached ({MAX_SECTOR_LINES} including start/finish).
        </p>
      )}
      {validation.valid && sectors.length === 0 && (
        <p className="pt-1 text-xs text-muted-foreground">
          Add a sector to start splitting the lap. Mark exactly three lines (start/finish + two)
          as Major sectors to save.
        </p>
      )}
    </div>
  );
}

interface SectorRowProps {
  index: number;
  label: string;
  sector: CourseSector;
  selected: boolean;
  onSelect: () => void;
  onToggleMajor: () => void;
  onRemove: () => void;
}

function SectorRow({ index, label, sector, selected, onSelect, onToggleMajor, onRemove }: SectorRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: sortableId(index) });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const color = sector.major ? '#a855f7' : '#38bdf8';

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex items-center gap-2 rounded-md border px-2 py-1.5 transition-colors',
        sector.major ? 'font-semibold' : 'ml-5',
        selected ? 'border-primary bg-primary/10' : 'border-border bg-card hover:bg-accent/40',
        isDragging && 'opacity-60 shadow-lg',
      )}
    >
      <button
        type="button"
        className="cursor-grab touch-none text-muted-foreground active:cursor-grabbing"
        aria-label="Drag to reorder"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: color }} />
      <button type="button" onClick={onSelect} className="flex-1 text-left text-sm">
        Sector {label}
      </button>
      <label className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        Major
        <Switch checked={sector.major} onCheckedChange={onToggleMajor} aria-label="Mark as major sector" />
      </label>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 text-muted-foreground hover:text-destructive"
        aria-label="Delete sector"
        onClick={onRemove}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
