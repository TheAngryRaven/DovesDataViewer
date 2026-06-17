import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Gauge, LogOut, ArrowLeft } from 'lucide-react';
import { SubmissionsTab } from '@/components/admin/SubmissionsTab';
import { TracksTab } from '@/components/admin/TracksTab';
import { CoursesTab } from '@/components/admin/CoursesTab';
import { ToolsTab } from '@/components/admin/ToolsTab';
import { BannedIpsTab } from '@/components/admin/BannedIpsTab';
import { MessagesTab } from '@/components/admin/MessagesTab';
import { UsersTab } from '@/components/admin/UsersTab';

export default function Admin() {
  const { t } = useTranslation('admin');
  const { user, isAdmin, loading, logout } = useAuth();
  const navigate = useNavigate();
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (!loading && !user) {
      navigate('/login');
    } else if (!loading && user && !isAdmin) {
      navigate('/');
    }
  }, [user, isAdmin, loading, navigate]);

  if (loading) {
    return <div className="min-h-screen bg-background flex items-center justify-center text-muted-foreground">{t('loading')}</div>;
  }

  if (!user || !isAdmin) return null;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Gauge className="w-8 h-8 text-primary" />
            <div>
              <h1 className="text-xl font-semibold text-foreground">{t('panelTitle')}</h1>
              <p className="text-sm text-muted-foreground">{user.email}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
              <ArrowLeft className="w-4 h-4 mr-2" /> {t('home')}
            </Button>
            <Button variant="outline" size="sm" onClick={logout}>
              <LogOut className="w-4 h-4 mr-2" /> {t('logout')}
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 p-6 max-w-6xl mx-auto w-full">
        <Tabs defaultValue="messages" className="w-full">
          <TabsList className="grid w-full grid-cols-7">
            <TabsTrigger value="messages" className="relative">
              {t('tabs.messages')}
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="submissions">{t('tabs.submissions')}</TabsTrigger>
            <TabsTrigger value="users">{t('tabs.users')}</TabsTrigger>
            <TabsTrigger value="tracks">{t('tabs.tracks')}</TabsTrigger>
            <TabsTrigger value="courses">{t('tabs.courses')}</TabsTrigger>
            <TabsTrigger value="tools">{t('tabs.tools')}</TabsTrigger>
            <TabsTrigger value="banned">{t('tabs.banned')}</TabsTrigger>
          </TabsList>
          <TabsContent value="messages"><MessagesTab onUnreadCount={setUnreadCount} /></TabsContent>
          <TabsContent value="submissions"><SubmissionsTab /></TabsContent>
          <TabsContent value="users"><UsersTab /></TabsContent>
          <TabsContent value="tracks"><TracksTab /></TabsContent>
          <TabsContent value="courses"><CoursesTab /></TabsContent>
          <TabsContent value="tools"><ToolsTab /></TabsContent>
          <TabsContent value="banned"><BannedIpsTab /></TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
