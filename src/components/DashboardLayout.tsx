import React from "react";
import {
  LayoutDashboard,
  Mic,
  History,
  CreditCard,
  Settings,
  LogOut,
  Menu,
  X,
  LifeBuoy,
  Sparkles,
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

const PRIMARY_NAV: NavItem[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "record", label: "Record & Upload", icon: Mic },
  { id: "history", label: "Meeting History", icon: History },
];

const SECONDARY_NAV: NavItem[] = [
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

function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <div className="w-9 h-9 rounded-xl bg-[#0b1f3a] flex items-center justify-center shrink-0">
        <Mic className="w-4 h-4 text-white" />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-bold tracking-tight text-slate-900 truncate">
          MinutesFlow <span className="text-blue-600">AI</span>
        </p>
        {!compact && <p className="text-[11px] text-slate-500 font-medium">Meeting intelligence</p>}
      </div>
    </div>
  );
}

function NavButton({
  item,
  active,
  onClick,
}: {
  item: NavItem;
  active: boolean;
  onClick: () => void;
}) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2.5 min-h-10 rounded-xl text-sm font-medium transition-colors cursor-pointer ${
        active
          ? "bg-blue-50 text-blue-700"
          : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
      }`}
    >
      <Icon className={`w-[18px] h-[18px] shrink-0 ${active ? "text-blue-600" : "text-slate-400"}`} />
      <span>{item.label}</span>
    </button>
  );
}

function SidebarChrome({
  activeTab,
  handleTabChange,
  meetingCredits,
  unlimitedCredits,
  onOpenManual,
  onOpenLegal,
  compactLogo = false,
}: {
  activeTab: DashboardTab;
  handleTabChange: (tab: DashboardTab) => void;
  meetingCredits: number;
  unlimitedCredits: boolean;
  onOpenManual?: () => void;
  onOpenLegal?: (type: LegalDocType) => void;
  compactLogo?: boolean;
}) {
  return (
    <>
      <div className="px-5 py-5 border-b border-slate-200">
        <Logo compact={compactLogo} />
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        <p className="px-3 mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          Workspace
        </p>
        {PRIMARY_NAV.map((item) => (
          <div key={item.id}>
            <NavButton
              item={item}
              active={activeTab === item.id}
              onClick={() => handleTabChange(item.id)}
            />
          </div>
        ))}

        <div className="my-4 mx-3 border-t border-slate-200" />

        <p className="px-3 mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          Account
        </p>
        {SECONDARY_NAV.map((item) => (
          <div key={item.id}>
            <NavButton
              item={item}
            active={
              item.id === "credits"
                ? activeTab === "credits"
                : activeTab === item.id
            }
              onClick={() => handleTabChange(item.id)}
            />
          </div>
        ))}

        {onOpenManual && (
          <button
            type="button"
            onClick={onOpenManual}
            className="w-full flex items-center gap-3 px-3 py-2.5 min-h-10 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors cursor-pointer"
          >
            <LifeBuoy className="w-[18px] h-[18px] shrink-0 text-slate-400" />
            <span>Help &amp; Support</span>
          </button>
        )}
      </nav>

      <div className="p-4 border-t border-slate-200 space-y-3">
        <div className="rounded-xl bg-slate-50 border border-slate-200 px-3.5 py-3">
          <div className="flex items-center gap-2 text-slate-500">
            <Sparkles className="w-3.5 h-3.5" />
            <span className="text-[11px] font-semibold uppercase tracking-wide">Credits</span>
          </div>
          <p className="mt-1 text-sm font-semibold text-slate-900">
            {unlimitedCredits
              ? "Unlimited units"
              : `${meetingCredits} unit${meetingCredits !== 1 ? "s" : ""} remaining`}
          </p>
          <button
            type="button"
            onClick={() => handleTabChange("credits")}
            className="mt-2 text-xs font-semibold text-blue-600 hover:text-blue-700 cursor-pointer"
          >
            Buy credits
          </button>
        </div>
        {onOpenManual && <ManualLink onOpen={onOpenManual} />}
        {onOpenLegal && <LegalLinks onOpen={onOpenLegal} />}
        <AiDisclaimer />
      </div>
    </>
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
    <div className="min-h-screen min-h-[100dvh] bg-[#f4f6f9] flex safe-area-x">
      <aside className="hidden lg:flex w-[260px] xl:w-[280px] flex-col bg-white border-r border-slate-200 shrink-0">
        <SidebarChrome
          activeTab={activeTab}
          handleTabChange={handleTabChange}
          meetingCredits={meetingCredits}
          unlimitedCredits={unlimitedCredits}
          onOpenManual={onOpenManual}
          onOpenLegal={onOpenLegal}
        />
      </aside>

      {sidebarOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]"
            onClick={() => setSidebarOpen(false)}
          />
          <aside className="absolute left-0 top-0 bottom-0 w-[min(18rem,88vw)] bg-white border-r border-slate-200 flex flex-col shadow-2xl safe-area-pt safe-area-pb">
            <div className="absolute top-3 right-3 z-10">
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                className="min-h-10 min-w-10 inline-flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 cursor-pointer"
                aria-label="Close menu"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <SidebarChrome
              activeTab={activeTab}
              handleTabChange={handleTabChange}
              meetingCredits={meetingCredits}
              unlimitedCredits={unlimitedCredits}
              onOpenManual={onOpenManual}
              onOpenLegal={onOpenLegal}
              compactLogo
            />
          </aside>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        <header className="min-h-14 sm:min-h-16 border-b border-slate-200 px-3 sm:px-6 flex items-center justify-between gap-2 bg-white/90 backdrop-blur-md sticky top-0 z-40 safe-area-pt">
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden min-h-10 min-w-10 inline-flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 cursor-pointer"
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="lg:hidden min-w-0">
              <Logo compact />
            </div>
            <p className="hidden lg:block text-sm font-semibold text-slate-800">
              {activeTab === "record"
                ? "Record & Upload"
                : activeTab === "credits"
                ? "Buy Credits"
                : activeTab === "payments"
                ? "Payments & Billing"
                : activeTab === "history"
                ? "Meeting History"
                : activeTab === "settings"
                ? "Account Settings"
                : "Dashboard"}
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => handleTabChange("credits")}
              className="inline-flex items-center gap-1.5 min-h-9 px-2.5 sm:px-3 rounded-full text-xs sm:text-sm font-semibold bg-slate-100 text-slate-700 border border-slate-200 hover:bg-slate-200/70 cursor-pointer transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5 text-blue-600" />
              <span>
                {unlimitedCredits ? "Unlimited" : meetingCredits}
                <span className="hidden sm:inline">
                  {unlimitedCredits ? "" : ` credit${meetingCredits !== 1 ? "s" : ""}`}
                </span>
              </span>
            </button>

            <div className="flex items-center gap-2 border-l border-slate-200 pl-2 sm:pl-3">
              {user.photoURL ? (
                <img
                  src={user.photoURL}
                  alt=""
                  className="hidden sm:block w-8 h-8 rounded-full border border-slate-200 object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="hidden sm:flex w-8 h-8 rounded-full bg-slate-100 border border-slate-200 items-center justify-center font-bold text-slate-600 text-xs">
                  {getUserInitials()}
                </div>
              )}
              <div className="hidden md:block text-right">
                <p className="text-sm font-medium text-slate-800 truncate max-w-[140px]">
                  {user.displayName}
                </p>
                <p className="text-xs text-slate-500 truncate max-w-[140px]">{user.email}</p>
              </div>
              <button
                type="button"
                onClick={onSignOut}
                className="min-h-10 min-w-10 inline-flex items-center justify-center rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
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

      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 px-1 pt-1 safe-area-pb safe-area-x">
        <div className="flex items-stretch justify-around gap-0.5 max-w-lg mx-auto">
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
                className={`flex-1 flex flex-col items-center justify-center gap-0.5 min-h-12 px-1 rounded-xl transition-colors cursor-pointer ${
                  active ? "text-blue-600 bg-blue-50" : "text-slate-500"
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-xs font-medium leading-tight">{item.label}</span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            aria-label="More menu"
            className={`flex-1 flex flex-col items-center justify-center gap-0.5 min-h-12 px-1 rounded-xl transition-colors cursor-pointer ${
              activeTab === "payments" || activeTab === "settings"
                ? "text-blue-600 bg-blue-50"
                : "text-slate-500"
            }`}
          >
            <Menu className="w-5 h-5" />
            <span className="text-xs font-medium leading-tight">More</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
