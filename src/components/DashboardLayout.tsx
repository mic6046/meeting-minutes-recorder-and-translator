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
import { AiDisclaimer, LegalLinks, type LegalDocType } from "./LegalModal";
import { ManualLink } from "./OperationManualModal";

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
  unlimitedCredits?: boolean;
  onSignOut: () => void;
  getUserInitials: () => string;
  children: React.ReactNode;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  onOpenLegal?: (type: LegalDocType) => void;
  onOpenManual?: () => void;
}

function Logo() {
  return (
    <div className="flex items-center gap-3 min-w-0">
      <div className="w-9 h-9 bg-gradient-to-br from-indigo-600 to-violet-600 rounded-xl flex items-center justify-center shadow-md shadow-indigo-600/20 shrink-0">
        <Mic className="w-5 h-5 text-white" />
      </div>
      <span className="text-lg font-bold tracking-tight truncate">
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
      className={`w-full flex items-center gap-3 px-4 py-3 min-h-11 rounded-xl text-sm font-medium transition-all cursor-pointer ${
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
  unlimitedCredits = false,
  onSignOut,
  getUserInitials,
  children,
  sidebarOpen,
  setSidebarOpen,
  onOpenLegal,
  onOpenManual,
}: DashboardLayoutProps) {
  const handleTabChange = (tab: DashboardTab) => {
    onTabChange(tab);
    setSidebarOpen(false);
  };

  return (
    <div className="min-h-screen min-h-[100dvh] bg-slate-950 flex safe-area-x">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-64 flex-col border-r border-slate-800 bg-slate-900/50 shrink-0">
        <div className="p-6 border-b border-slate-800 safe-area-pt">
          <Logo />
        </div>
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
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
        <div className="p-4 border-t border-slate-800 space-y-3">
          {onOpenManual && <ManualLink onOpen={onOpenManual} />}
          {onOpenLegal && <LegalLinks onOpen={onOpenLegal} />}
          <AiDisclaimer />
        </div>
      </aside>

      {/* Mobile drawer overlay */}
      {sidebarOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
            onClick={() => setSidebarOpen(false)}
          />
          <aside className="absolute left-0 top-0 bottom-0 w-[min(18rem,88vw)] bg-slate-900 border-r border-slate-800 flex flex-col shadow-2xl safe-area-pt safe-area-pb">
            <div className="p-6 border-b border-slate-800 flex items-center justify-between gap-3">
              <Logo />
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                className="min-h-11 min-w-11 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800"
                aria-label="Close menu"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
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
            <div className="p-4 border-t border-slate-800 space-y-3">
              {onOpenManual && <ManualLink onOpen={onOpenManual} />}
              {onOpenLegal && <LegalLinks onOpen={onOpenLegal} />}
              <AiDisclaimer />
            </div>
          </aside>
        </div>
      )}

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="min-h-16 border-b border-slate-800 px-4 sm:px-6 flex items-center justify-between bg-slate-900/50 backdrop-blur-md sticky top-0 z-40 safe-area-pt">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden min-h-11 min-w-11 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800"
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="lg:hidden min-w-0">
              <Logo />
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-4 shrink-0">
            <button
              type="button"
              onClick={() => handleTabChange("credits")}
              className={`inline-flex items-center gap-1.5 sm:gap-2 min-h-10 px-2.5 sm:px-3 rounded-full text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
                unlimitedCredits || meetingCredits > 0
                  ? "bg-indigo-500/10 text-indigo-400 border border-indigo-500/30 hover:bg-indigo-500/20"
                  : "bg-amber-500/10 text-amber-400 border border-amber-500/30 hover:bg-amber-500/20"
              }`}
            >
              <CreditCard className="w-4 h-4 shrink-0" />
              <span className="truncate max-w-[7.5rem] sm:max-w-none">
                {unlimitedCredits
                  ? "Unlimited"
                  : `${meetingCredits} Credit${meetingCredits !== 1 ? "s" : ""}`}
              </span>
            </button>

            <div className="flex items-center gap-2 border-l border-slate-800 pl-2 sm:pl-4">
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
                className="min-h-11 min-w-11 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition-all cursor-pointer"
                title="Sign out"
                aria-label="Sign out"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8 pb-28 lg:pb-8 overflow-auto">
          {children}
        </main>
      </div>

      {/* Phone / tablet bottom navigation */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-slate-900/95 backdrop-blur-md border-t border-slate-800 px-1 pt-1 safe-area-pb safe-area-x">
        <div className="flex items-stretch justify-around gap-0.5">
          {MOBILE_NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleTabChange(item.id)}
                aria-label={item.label}
                aria-current={active ? "page" : undefined}
                className={`flex-1 flex flex-col items-center justify-center gap-0.5 min-h-12 px-1 rounded-xl transition-all cursor-pointer ${
                  active ? "text-indigo-400" : "text-slate-500"
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[10px] sm:text-xs font-medium leading-tight">{item.label}</span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            aria-label="More menu"
            className={`flex-1 flex flex-col items-center justify-center gap-0.5 min-h-12 px-1 rounded-xl transition-all cursor-pointer ${
              activeTab === "payments" || activeTab === "settings"
                ? "text-indigo-400"
                : "text-slate-500"
            }`}
          >
            <Menu className="w-5 h-5" />
            <span className="text-[10px] sm:text-xs font-medium leading-tight">More</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
