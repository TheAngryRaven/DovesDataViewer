import { useState } from 'react';
import { Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import type { CourseFormProps } from '@/hooks/useTrackEditorForm';

export function CourseForm({
  trackName, courseName, latA, lonA, latB, lonB,
  sector2, sector3,
  onTrackNameChange, onCourseNameChange,
  onLatAChange, onLonAChange, onLatBChange, onLonBChange,
  onSector2Change, onSector3Change,
  onSubmit, onCancel, submitLabel, showTrackName = true,
}: CourseFormProps) {
  const [showSectors, setShowSectors] = useState(
    Boolean(sector2.aLat || sector2.aLon || sector3.aLat || sector3.aLon)
  );
  const stopKeys = (e: React.KeyboardEvent<HTMLInputElement>) => e.stopPropagation();

  return (
    <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
      {showTrackName && (
        <div>
          <Label htmlFor="trackName">Track Name</Label>
          <Input id="trackName" value={trackName} onChange={(e) => onTrackNameChange(e.target.value)} onKeyDownCapture={stopKeys} placeholder="e.g., Orlando Kart Center" className="font-mono" />
        </div>
      )}
      <div>
        <Label htmlFor="courseName">Course Name</Label>
        <Input id="courseName" value={courseName} onChange={(e) => onCourseNameChange(e.target.value)} onKeyDownCapture={stopKeys} placeholder="e.g., Full Track" className="font-mono" />
      </div>

      <div className="space-y-3">
        <p className="text-sm font-medium text-muted-foreground">Start/Finish Line (required)</p>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">Point A Lat</Label>
            <Input value={latA} onChange={(e) => onLatAChange(e.target.value)} onKeyDownCapture={stopKeys} placeholder="28.4127" className="font-mono text-sm" />
          </div>
          <div>
            <Label className="text-xs">Point A Lon</Label>
            <Input value={lonA} onChange={(e) => onLonAChange(e.target.value)} onKeyDownCapture={stopKeys} placeholder="-81.3797" className="font-mono text-sm" />
          </div>
          <div>
            <Label className="text-xs">Point B Lat</Label>
            <Input value={latB} onChange={(e) => onLatBChange(e.target.value)} onKeyDownCapture={stopKeys} placeholder="28.4128" className="font-mono text-sm" />
          </div>
          <div>
            <Label className="text-xs">Point B Lon</Label>
            <Input value={lonB} onChange={(e) => onLonBChange(e.target.value)} onKeyDownCapture={stopKeys} placeholder="-81.3795" className="font-mono text-sm" />
          </div>
        </div>
      </div>

      <Collapsible open={showSectors} onOpenChange={setShowSectors}>
        <CollapsibleTrigger asChild>
          <Button variant="outline" size="sm" className="w-full text-xs">
            {showSectors ? 'Hide Sector Lines (optional)' : 'Add Sector Lines (optional)'}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-4 mt-3">
          <p className="text-xs text-muted-foreground">Both sector 2 and sector 3 lines must be defined for sector timing to work.</p>

          <div className="space-y-2 p-3 border rounded bg-muted/20">
            <p className="text-sm font-medium text-purple-400">Sector 2 Line</p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Point A Lat</Label>
                <Input value={sector2.aLat} onChange={(e) => onSector2Change('aLat', e.target.value)} onKeyDownCapture={stopKeys} placeholder="Lat" className="font-mono text-sm" />
              </div>
              <div>
                <Label className="text-xs">Point A Lon</Label>
                <Input value={sector2.aLon} onChange={(e) => onSector2Change('aLon', e.target.value)} onKeyDownCapture={stopKeys} placeholder="Lon" className="font-mono text-sm" />
              </div>
              <div>
                <Label className="text-xs">Point B Lat</Label>
                <Input value={sector2.bLat} onChange={(e) => onSector2Change('bLat', e.target.value)} onKeyDownCapture={stopKeys} placeholder="Lat" className="font-mono text-sm" />
              </div>
              <div>
                <Label className="text-xs">Point B Lon</Label>
                <Input value={sector2.bLon} onChange={(e) => onSector2Change('bLon', e.target.value)} onKeyDownCapture={stopKeys} placeholder="Lon" className="font-mono text-sm" />
              </div>
            </div>
          </div>

          <div className="space-y-2 p-3 border rounded bg-muted/20">
            <p className="text-sm font-medium text-purple-400">Sector 3 Line</p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Point A Lat</Label>
                <Input value={sector3.aLat} onChange={(e) => onSector3Change('aLat', e.target.value)} onKeyDownCapture={stopKeys} placeholder="Lat" className="font-mono text-sm" />
              </div>
              <div>
                <Label className="text-xs">Point A Lon</Label>
                <Input value={sector3.aLon} onChange={(e) => onSector3Change('aLon', e.target.value)} onKeyDownCapture={stopKeys} placeholder="Lon" className="font-mono text-sm" />
              </div>
              <div>
                <Label className="text-xs">Point B Lat</Label>
                <Input value={sector3.bLat} onChange={(e) => onSector3Change('bLat', e.target.value)} onKeyDownCapture={stopKeys} placeholder="Lat" className="font-mono text-sm" />
              </div>
              <div>
                <Label className="text-xs">Point B Lon</Label>
                <Input value={sector3.bLon} onChange={(e) => onSector3Change('bLon', e.target.value)} onKeyDownCapture={stopKeys} placeholder="Lon" className="font-mono text-sm" />
              </div>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>

      <div className="flex gap-2 pt-2">
        <Button onClick={onSubmit} className="flex-1">
          <Check className="w-4 h-4 mr-2" />
          {submitLabel}
        </Button>
        <Button variant="outline" onClick={onCancel}>
          <X className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
