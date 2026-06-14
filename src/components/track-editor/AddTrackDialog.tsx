import { useTranslation } from 'react-i18next';
import { Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

interface AddTrackDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trackName: string;
  shortName: string;
  onTrackNameChange: (value: string) => void;
  onShortNameChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

/**
 * Create a new track — just a name + short name. A track is simply a couple of
 * names; its courses (each with a start/finish line) are added afterwards from
 * the track's course list, so adding a track stays a quick, form-light action.
 */
export function AddTrackDialog({
  open, onOpenChange,
  trackName, shortName,
  onTrackNameChange, onShortNameChange,
  onSubmit, onCancel,
}: AddTrackDialogProps) {
  const { t } = useTranslation('tracks');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild><span className="sr-only">{t('addTrack.srTrigger')}</span></DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('addTrack.title')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="newTrackName">{t('addTrack.trackName')}</Label>
            <Input id="newTrackName" value={trackName} onChange={(e) => onTrackNameChange(e.target.value)} onKeyDownCapture={(e) => e.stopPropagation()} placeholder={t('addTrack.trackNamePlaceholder')} className="font-mono" autoFocus />
          </div>
          <div>
            <Label htmlFor="newTrackShortName">{t('addTrack.shortName')}</Label>
            <Input id="newTrackShortName" value={shortName} onChange={(e) => onShortNameChange(e.target.value)} onKeyDownCapture={(e) => e.stopPropagation()} placeholder={t('addTrack.shortNamePlaceholder')} maxLength={8} className="font-mono" />
            <p className="text-xs text-muted-foreground mt-1">{t('addTrack.shortNameHint')}</p>
          </div>
          <div className="flex gap-2 pt-2">
            <Button onClick={onSubmit} className="flex-1" disabled={!trackName.trim()}>
              <Check className="w-4 h-4 mr-2" />
              {t('addTrack.create')}
            </Button>
            <Button variant="outline" onClick={onCancel}>
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
