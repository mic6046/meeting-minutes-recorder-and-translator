import React from "react";
import {
  LayoutDashboard,
  Mic,
  History,
  Sparkles,
  CreditCard,
  Settings,
  LogOut,
  Menu,
  X,
} from "lucide-react";
import { LegalLinks, type LegalDocType } from "./LegalModal";

export type DashboardTab =
  | "dashboard"
  | "record"
  | "history"
  | "credits"
  | "payments"
  | "settings";

interface NavItem {
  id: DashboardTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV_ITEMS: NavItem[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "record", label: "Record & Upload", icon: Mic },
  { id: "history", label: "Meeting History", icon: History },
  { id: "credits", label: "Buy Credits", icon: Sparkles },
  { id: "payments", label: "Payments & Billing", icon: CreditCard },
  { id: "settings", label: "Account Settings", icon: Settings },
];

const MOBILE_NAV_ITEMS: NavItem[] = [
  { id: "dashboard", label: "Home", icon: LayoutDashboard },
  { id: "record", label: "Record", icon: Mic },
  { id: "history", label: "History", icon: History },
  { id: "credits", label: "Credits", icon: Sparkles },
];

interface DashboardLayoutProps {
  activeTab: DashboardTab;
  onTabChange: (tab: DashboardTab) => void;
  user: {
    displayName?: string | null;
    email?: string | null;
    photoURL?: string | null;
    uid: string;
  };
  meetingCredits: number;
  onSignOut: () => void;
  getUserInitials: () => string;
  children: React.ReactNode;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  onOpenLegal?: (type: LegalDocType) => void;
}

function Logo() {
  return (
    <div className="flex items-center gap-3">
      <div className="w-9 h-9 bg-gradient-to-br from-indigo-600 to-violet-600 rounded-xl flex items-center justify-center shadow-md shadow-indigo-600/20">
        <Mic className="w-5 h-5 text-white" />
      </div>
      <span className="text-lg font-bold tracking-tight">
        MinutesFlow <span className="text-indigo-400">AI</span>
      </span>
    </div>
  );
}

function NavButton({
  item,
  active,
  onClick,
  compact = false,
}: {
  item: NavItem;
  active: boolean;
  onClick: () => void;
  compact?: boolean;
}) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all cursor-pointer ${
        active
          ? "bg-indigo-600/20 text-indigo-300 border border-indigo-500/30"
          : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
      } ${compact ? "justify-center px-2" : ""}`}
    >
      <Icon className="w-5 h-5 shrink-0" />
      {!compact && <span>{item.label}</span>}
    </button>
  );
}

export function DashboardLayout({
  activeTab,
  onTabChange,
  user,
  meetingCredits,
  onSignOut,
  getUserInitials,
  children,
  sidebarOpen,
  setSidebarOpen,
  onOpenLegal,
}: DashboardLayoutProps) {
  const handleTabChange = (tab: DashboardTab) => {
    onTabChange(tab);
    setSidebarOpen(false);
  };

  return (
    <div className="min-h-screen bg-slate-950 flex">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-64 flex-col border-r border-slate-800 bg-slate-900/50 shrink-0">
        <div className="p-6 border-b border-slate-800">
          <Logo />
        </div>
        <nav className="flex-1 p-4 space-y-1">
          {NAV_ITEMS.map((item) => (
            <div key={item.id}>
              <NavButton
                item={item}
                active={activeTab === item.id}
                onClick={() => handleTabChange(item.id)}
              />
            </div>
          ))}
        </nav>
        {onOpenLegal && (
          <div className="p-4 border-t border-slate-800">
            <LegalLinks onOpen={onOpenLegal} />
          </div>
        )}
      </aside>

      {/* Mobile drawer overlay */}
      {sidebarOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
            onClick={() => setSidebarOpen(false)}
          />
          <aside className="absolute left-0 top-0 bottom-0 w-72 bg-slate-900 border-r border-slate-800 flex flex-col shadow-2xl">
            <div className="p-6 border-b border-slate-800 flex items-center justify-between">
              <Logo />
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                className="p-2 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800"
                aria-label="Close menu"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 p-4 space-y-1">
              {NAV_ITEMS.map((item) => (
                <div key={item.id}>
                  <NavButton
                    item={item}
                    active={activeTab === item.id}
                    onClick={() => handleTabChange(item.id)}
                  />
                </div>
              ))}
            </nav>
            {onOpenLegal && (
              <div className="p-4 border-t border-slate-800">
                <LegalLinks onOpen={onOpenLegal} />
              </div>
            )}
          </aside>
        </div>
      )}

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 border-b border-slate-800 px-4 sm:px-6 flex items-center justify-between bg-slate-900/50 backdrop-blur-md sticky top-0 z-40">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-2 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800"
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="lg:hidden">
              <Logo />
            </div>
          </div>

          <div className="flex items-center gap-3 sm:gap-4">
            <button
              type="button"
              onClick={() => handleTabChange("credits")}
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-semibold transition-all cursor-pointer ${
                meetingCredits > 0
                  ? "bg-indigo-500/10 text-indigo-400 border border-indigo-500/30 hover:bg-indigo-500/20"
                  : "bg-amber-500/10 text-amber-400 border border-amber-500/30 hover:bg-amber-500/20"
              }`}
            >
              <CreditCard className="w-4 h-4" />
              <span>{meetingCredits} Credit{meetingCredits !== 1 ? "s" : ""}</span>
            </button>

            <div className="flex items-center gap-2 border-l border-slate-800 pl-3 sm:pl-4">
              {user.photoURL ? (
                <img
                  src={user.photoURL}
                  alt="Avatar"
                  className="w-9 h-9 rounded-full border border-slate-700 object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="w-9 h-9 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center font-bold text-indigo-300 text-sm">
                  {getUserInitials()}
                </div>
              )}
              <div className="hidden md:block text-right">
                <p className="text-sm font-medium text-slate-200 truncate max-w-[140px]">
                  {user.displayName}
                </p>
                <p className="text-xs text-slate-500 truncate max-w-[140px]">{user.email}</p>
              </div>
              <button
                type="button"
                onClick={onSignOut}
                className="p-2 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition-all cursor-pointer"
                title="Sign out"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8 pb-24 lg:pb-8 overflow-auto">
          {children}
        </main>
      </div>

      {/* Mobile bottom navigation */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-slate-900/95 backdrop-blur-md border-t border-slate-800 px-2 py-2 safe-area-pb">
        <div className="flex items-center justify-around">
          {MOBILE_NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleTabChange(item.id)}
                className={`flex flex-col items-center gap-1 px-3 py-2 rounded-xl transition-all cursor-pointer ${
                  active ? "text-indigo-400" : "text-slate-500"
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-xs font-medium">{item.label}</span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className={`flex flex-col items-center gap-1 px-3 py-2 rounded-xl transition-all cursor-pointer ${
              activeTab === "payments" || activeTab === "settings"
                ? "text-indigo-400"
                : "text-slate-500"
            }`}
          >
            <Menu className="w-5 h-5" />
            <span className="text-xs font-medium">More</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
