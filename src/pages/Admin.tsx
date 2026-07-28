import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { useIsMobile } from '@/hooks/use-mobile';
import { Button } from '@/components/ui/button';
import {
  LogOut, ArrowLeft, PanelLeftClose, PanelLeftOpen,
  Mail, LifeBuoy, Inbox, Users, Map, Route, Trophy, Newspaper, Wrench, Ban,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { BrandLogo } from "@/components/BrandLogo";
import { SubmissionsTab } from '@/components/admin/SubmissionsTab';
import { TracksTab } from '@/components/admin/TracksTab';
import { CoursesTab } from '@/components/admin/CoursesTab';
import { ToolsTab } from '@/components/admin/ToolsTab';
import { BannedIpsTab } from '@/components/admin/BannedIpsTab';
import { MessagesTab } from '@/components/admin/MessagesTab';
import { SupportTab } from '@/components/admin/SupportTab';
import { UsersTab } from '@/components/admin/UsersTab';
import { LeaderboardsTab } from '@/components/admin/LeaderboardsTab';
import { UpdatesTab } from '@/components/admin/UpdatesTab';

type AdminPage =
  | 'messages' | 'support' | 'submissions' | 'users' | 'tracks'
  | 'courses' | 'leaderboards' | 'updates' | 'tools' | 'banned';

// Sidebar order = triage priority: inboxes first, then content, then tools.
const NAV_ITEMS: { id: AdminPage; icon: LucideIcon }[] = [
  { id: 'messages', icon: Mail },
  { id: 'support', icon: LifeBuoy },
  { id: 'submissions', icon: Inbox },
  { id: 'users', icon: Users },
  { id: 'tracks', icon: Map },
  { id: 'courses', icon: Route },
  { id: 'leaderboards', icon: Trophy },
  { id: 'updates', icon: Newspaper },
  { id: 'tools', icon: Wrench },
  { id: 'banned', icon: Ban },
];

export default function Admin() {
  const { t } = useTranslation('admin');
  const { user, isAdmin, loading, logout } = useAuth();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [active, setActive] = useState<AdminPage>('messages');
  // null = follow the device default (open on desktop, collapsed on mobile)
  // until the admin toggles it themselves.
  const [sidebarOpen, setSidebarOpen] = useState<boolean | null>(null);
  const open = sidebarOpen ?? !isMobile;
  const [unreadCount, setUnreadCount] = useState(0);
  const [unreadSupportCount, setUnreadSupportCount] = useState(0);

  useEffect(() => {
    if (!loading && !user) {
      navigate('/login');
    } else if (!loading && user && !isAdmin) {
      navigate('/');
    }
  }, [user, isAdmin, loading, navigate]);

  if (loading) {
    return <div className="min-h-screen bg-background flex items-center justify-center text-muted-foreground safe-area-inset">{t('loading')}</div>;
  }

  if (!user || !isAdmin) return null;

  const badges: Partial<Record<AdminPage, number>> = {
    messages: unreadCount,
    support: unreadSupportCount,
  };

  const selectPage = (id: AdminPage) => {
    setActive(id);
    // On phones the expanded menu eats the whole content width — tuck it away
    // after navigating so the page is immediately visible.
    if (isMobile) setSidebarOpen(false);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col safe-area-inset">
      <header className="border-b border-border px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BrandLogo className="w-8 h-8" />
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

      <div className="flex flex-1 min-h-0">
        <aside className={cn(
          "shrink-0 border-r border-border flex flex-col transition-[width] duration-200",
          open ? "w-56" : "w-14",
        )}>
          <button
            onClick={() => setSidebarOpen(!open)}
            aria-label={open ? t('nav.collapse') : t('nav.expand')}
            className="flex items-center gap-3 px-4 h-12 text-muted-foreground hover:text-foreground transition-colors border-b border-border"
          >
            {open ? <PanelLeftClose className="w-5 h-5 shrink-0" /> : <PanelLeftOpen className="w-5 h-5 shrink-0" />}
            {open && <span className="text-sm font-medium">{t('nav.menu')}</span>}
          </button>
          <nav className="flex-1 overflow-y-auto py-2">
            {NAV_ITEMS.map(({ id, icon: Icon }) => {
              const badge = badges[id] ?? 0;
              return (
                <button
                  key={id}
                  onClick={() => selectPage(id)}
                  title={open ? undefined : t(`tabs.${id}`)}
                  className={cn(
                    "relative w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors",
                    active === id
                      ? "text-primary bg-primary/10 border-r-2 border-primary font-medium"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                  )}
                >
                  <span className="relative shrink-0">
                    <Icon className="w-5 h-5" />
                    {badge > 0 && !open && (
                      <span className="absolute -top-1.5 -right-1.5 bg-destructive rounded-full w-2.5 h-2.5" />
                    )}
                  </span>
                  {open && (
                    <>
                      <span className="truncate">{t(`tabs.${id}`)}</span>
                      {badge > 0 && (
                        <span className="ml-auto bg-destructive text-destructive-foreground text-[10px] font-bold rounded-full min-w-5 h-5 px-1 flex items-center justify-center">
                          {badge > 99 ? "99+" : badge}
                        </span>
                      )}
                    </>
                  )}
                </button>
              );
            })}
          </nav>
        </aside>

        <main className="flex-1 min-w-0 overflow-y-auto p-6">
          <div className="max-w-6xl mx-auto w-full">
            {active === 'messages' && <MessagesTab onUnreadCount={setUnreadCount} />}
            {active === 'support' && <SupportTab onUnreadCount={setUnreadSupportCount} />}
            {active === 'submissions' && <SubmissionsTab />}
            {active === 'users' && <UsersTab />}
            {active === 'tracks' && <TracksTab />}
            {active === 'courses' && <CoursesTab />}
            {active === 'leaderboards' && <LeaderboardsTab />}
            {active === 'updates' && <UpdatesTab />}
            {active === 'tools' && <ToolsTab />}
            {active === 'banned' && <BannedIpsTab />}
          </div>
        </main>
      </div>
    </div>
  );
}
