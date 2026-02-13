import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Gauge, LogOut, ArrowLeft } from 'lucide-react';
import { SubmissionsTab } from '@/components/admin/SubmissionsTab';
import { TracksTab } from '@/components/admin/TracksTab';
import { CoursesTab } from '@/components/admin/CoursesTab';
import { ToolsTab } from '@/components/admin/ToolsTab';
import { BannedIpsTab } from '@/components/admin/BannedIpsTab';

export default function Admin() {
  const { user, isAdmin, loading, logout } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) {
      navigate('/login');
    } else if (!loading && user && !isAdmin) {
      navigate('/');
    }
  }, [user, isAdmin, loading, navigate]);

  if (loading) {
    return <div className="min-h-screen bg-background flex items-center justify-center text-muted-foreground">Loading...</div>;
  }

  if (!user || !isAdmin) return null;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Gauge className="w-8 h-8 text-primary" />
            <div>
              <h1 className="text-xl font-semibold text-foreground">Admin Panel</h1>
              <p className="text-sm text-muted-foreground">{user.email}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
              <ArrowLeft className="w-4 h-4 mr-2" /> Home
            </Button>
            <Button variant="outline" size="sm" onClick={logout}>
              <LogOut className="w-4 h-4 mr-2" /> Logout
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 p-6 max-w-6xl mx-auto w-full">
        <Tabs defaultValue="submissions" className="w-full">
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="submissions">Submissions</TabsTrigger>
            <TabsTrigger value="tracks">Tracks</TabsTrigger>
            <TabsTrigger value="courses">Courses</TabsTrigger>
            <TabsTrigger value="tools">Tools</TabsTrigger>
            <TabsTrigger value="banned">Banned IPs</TabsTrigger>
          </TabsList>
          <TabsContent value="submissions"><SubmissionsTab /></TabsContent>
          <TabsContent value="tracks"><TracksTab /></TabsContent>
          <TabsContent value="courses"><CoursesTab /></TabsContent>
          <TabsContent value="tools"><ToolsTab /></TabsContent>
          <TabsContent value="banned"><BannedIpsTab /></TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
