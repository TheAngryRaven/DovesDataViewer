import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/hooks/use-toast';
import { getDatabase } from '@/lib/db';
import { Download, Upload, FileJson, Archive } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import JSZip from 'jszip';

export function ToolsTab() {
  const [jsonOutput, setJsonOutput] = useState('');
  const [importJson, setImportJson] = useState('');
  const [loading, setLoading] = useState(false);

  const db = getDatabase();

  const handleBuildJson = async () => {
    setLoading(true);
    try {
      const json = await db.buildTracksJson();
      setJsonOutput(json);
      toast({ title: 'tracks.json built from database' });
    } catch (e: unknown) {
      toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' });
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
      
      // Edge function returns JSON map of {path: content}, build a real zip client-side
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
      toast({ title: 'Tracks ZIP downloaded' });
    } catch (e: unknown) {
      toast({ title: 'Error building ZIP', description: (e as Error).message, variant: 'destructive' });
    }
    setLoading(false);
  };

  const handleImport = async () => {
    if (!importJson.trim()) return;
    setLoading(true);
    try {
      await db.importFromTracksJson(importJson);
      setImportJson('');
      toast({ title: 'Database rebuilt from JSON' });
    } catch (e: unknown) {
      toast({ title: 'Import error', description: (e as Error).message, variant: 'destructive' });
    }
    setLoading(false);
  };

  return (
    <div className="space-y-6 mt-4">
      <div className="racing-card p-4 space-y-3">
        <h3 className="font-semibold text-foreground">Build tracks.json from Database</h3>
        <p className="text-sm text-muted-foreground">Generates the tracks.json file from all enabled tracks and courses in the database.</p>
        <div className="flex gap-2">
          <Button onClick={handleBuildJson} disabled={loading}>
            <FileJson className="w-4 h-4 mr-2" /> Build JSON
          </Button>
          {jsonOutput && (
            <Button variant="outline" onClick={handleDownloadJson}>
              <Download className="w-4 h-4 mr-2" /> Download
            </Button>
          )}
        </div>
        {jsonOutput && (
          <Textarea readOnly value={jsonOutput} className="font-mono text-xs h-48 resize-none bg-muted" />
        )}
      </div>

      <div className="racing-card p-4 space-y-3">
        <h3 className="font-semibold text-foreground">Build Tracks ZIP</h3>
        <p className="text-sm text-muted-foreground">Downloads individual track JSON files in a TRACKS/ folder, named by short name.</p>
        <Button onClick={handleBuildZip} disabled={loading}>
          <Archive className="w-4 h-4 mr-2" /> Build & Download ZIP
        </Button>
      </div>

      <div className="racing-card p-4 space-y-3">
        <h3 className="font-semibold text-foreground">Import tracks.json into Database</h3>
        <p className="text-sm text-muted-foreground">Paste a tracks.json file to rebuild the database. Existing tracks are updated, new tracks are added.</p>
        <Textarea
          value={importJson}
          onChange={e => setImportJson(e.target.value)}
          placeholder="Paste tracks.json content here..."
          className="font-mono text-xs h-32"
        />
        <Button onClick={handleImport} disabled={loading || !importJson.trim()}>
          <Upload className="w-4 h-4 mr-2" /> Import
        </Button>
      </div>
    </div>
  );
}
