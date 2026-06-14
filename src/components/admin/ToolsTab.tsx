import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/hooks/use-toast';
import { getDatabase } from '@/lib/db';
import { Download, Upload, FileJson, Archive, Pencil } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import JSZip from 'jszip';

export function ToolsTab() {
  const { t } = useTranslation('admin');
  const [jsonOutput, setJsonOutput] = useState('');
  const [drawingsOutput, setDrawingsOutput] = useState('');
  const [importJson, setImportJson] = useState('');
  const [importDrawingsJson, setImportDrawingsJson] = useState('');
  const [loading, setLoading] = useState(false);

  const db = getDatabase();

  const handleBuildJson = async () => {
    setLoading(true);
    try {
      const json = await db.buildTracksJson();
      setJsonOutput(json);
      toast({ title: t('tools.buildJsonDone') });
    } catch (e: unknown) {
      toast({ title: t('common.error'), description: (e as Error).message, variant: 'destructive' });
    }
    setLoading(false);
  };

  const handleDownloadJson = () => {
    const blob = new Blob([jsonOutput], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tracks.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleBuildZip = async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await supabase.functions.invoke('admin-build-zip', {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (resp.error) throw resp.error;
      
      const files: Record<string, string> = resp.data;
      const zip = new JSZip();
      for (const [path, content] of Object.entries(files)) {
        zip.file(path, content);
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'tracks.zip';
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: t('tools.buildZipDone') });
    } catch (e: unknown) {
      toast({ title: t('tools.buildZipError'), description: (e as Error).message, variant: 'destructive' });
    }
    setLoading(false);
  };

  const handleBuildDrawings = async () => {
    setLoading(true);
    try {
      const json = await db.buildDrawingsJson();
      setDrawingsOutput(json);
      toast({ title: t('tools.exportDrawingsDone') });
    } catch (e: unknown) {
      toast({ title: t('common.error'), description: (e as Error).message, variant: 'destructive' });
    }
    setLoading(false);
  };

  const handleDownloadDrawings = () => {
    const blob = new Blob([drawingsOutput], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'course_drawings.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = async () => {
    if (!importJson.trim()) return;
    setLoading(true);
    try {
      await db.importFromTracksJson(importJson);
      setImportJson('');
      toast({ title: t('tools.importDone') });
    } catch (e: unknown) {
      toast({ title: t('tools.importError'), description: (e as Error).message, variant: 'destructive' });
    }
    setLoading(false);
  };

  const handleImportDrawings = async () => {
    if (!importDrawingsJson.trim()) return;
    setLoading(true);
    try {
      await db.importDrawingsJson(importDrawingsJson);
      setImportDrawingsJson('');
      toast({ title: t('tools.importDrawingsDone') });
    } catch (e: unknown) {
      toast({ title: t('tools.importError'), description: (e as Error).message, variant: 'destructive' });
    }
    setLoading(false);
  };

  return (
    <div className="space-y-6 mt-4">
      <div className="racing-card p-4 space-y-3">
        <h3 className="font-semibold text-foreground">{t('tools.buildJsonTitle')}</h3>
        <p className="text-sm text-muted-foreground">{t('tools.buildJsonDesc')}</p>
        <div className="flex gap-2">
          <Button onClick={handleBuildJson} disabled={loading}>
            <FileJson className="w-4 h-4 mr-2" /> {t('tools.buildJson')}
          </Button>
          {jsonOutput && (
            <Button variant="outline" onClick={handleDownloadJson}>
              <Download className="w-4 h-4 mr-2" /> {t('tools.download')}
            </Button>
          )}
        </div>
        {jsonOutput && (
          <Textarea readOnly value={jsonOutput} className="font-mono text-xs h-48 resize-none bg-muted" />
        )}
      </div>

      <div className="racing-card p-4 space-y-3">
        <h3 className="font-semibold text-foreground">{t('tools.buildZipTitle')}</h3>
        <p className="text-sm text-muted-foreground">{t('tools.buildZipDesc')}</p>
        <Button onClick={handleBuildZip} disabled={loading}>
          <Archive className="w-4 h-4 mr-2" /> {t('tools.buildZip')}
        </Button>
      </div>

      <div className="racing-card p-4 space-y-3">
        <h3 className="font-semibold text-foreground">{t('tools.exportDrawingsTitle')}</h3>
        <p className="text-sm text-muted-foreground">{t('tools.exportDrawingsDesc')}</p>
        <div className="flex gap-2">
          <Button onClick={handleBuildDrawings} disabled={loading}>
            <Pencil className="w-4 h-4 mr-2" /> {t('tools.exportDrawings')}
          </Button>
          {drawingsOutput && (
            <Button variant="outline" onClick={handleDownloadDrawings}>
              <Download className="w-4 h-4 mr-2" /> {t('tools.download')}
            </Button>
          )}
        </div>
        {drawingsOutput && (
          <Textarea readOnly value={drawingsOutput} className="font-mono text-xs h-48 resize-none bg-muted" />
        )}
      </div>

      <div className="racing-card p-4 space-y-3">
        <h3 className="font-semibold text-foreground">{t('tools.importDrawingsTitle')}</h3>
        <p className="text-sm text-muted-foreground">{t('tools.importDrawingsDesc')}</p>
        <Textarea
          value={importDrawingsJson}
          onChange={e => setImportDrawingsJson(e.target.value)}
          placeholder={t('tools.importDrawingsPlaceholder')}
          className="font-mono text-xs h-32"
        />
        <Button onClick={handleImportDrawings} disabled={loading || !importDrawingsJson.trim()}>
          <Upload className="w-4 h-4 mr-2" /> {t('tools.importDrawings')}
        </Button>
      </div>

      <div className="racing-card p-4 space-y-3">
        <h3 className="font-semibold text-foreground">{t('tools.importJsonTitle')}</h3>
        <p className="text-sm text-muted-foreground">{t('tools.importJsonDesc')}</p>
        <Textarea
          value={importJson}
          onChange={e => setImportJson(e.target.value)}
          placeholder={t('tools.importJsonPlaceholder')}
          className="font-mono text-xs h-32"
        />
        <Button onClick={handleImport} disabled={loading || !importJson.trim()}>
          <Upload className="w-4 h-4 mr-2" /> {t('tools.import')}
        </Button>
      </div>
    </div>
  );
}
