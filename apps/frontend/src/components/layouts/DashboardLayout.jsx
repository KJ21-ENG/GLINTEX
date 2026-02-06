import React, { useState } from "react";
import { Outlet, NavLink, useLocation } from "react-router-dom";
import {
  PackagePlus,
  Package,
  ArrowRightFromLine,
  ArrowLeftToLine,
  ArrowRightLeft,
  Truck,
  Database,
  BarChart3,
  Settings,
  Menu,
  X,
  Moon,
  Sun,
  Factory,
  ClipboardPlus,
  Flame,
  Lock,
  FileText
} from "lucide-react";
import { useInventory } from "../../context/InventoryContext";
import { Button, Select } from "../ui";
import { cn } from "../../lib/utils";
import { getProcessDefinition, PROCESS_DEFINITIONS } from "../../constants/processes";
import { useAuth } from "../../context/AuthContext";
import { ACCESS_LEVELS, getPermissionLevel } from "../../utils/permissions";

const NAV_ITEMS = [
  { key: "inbound", label: "Inbound", icon: PackagePlus, permissions: ["inbound"] },
  { key: "stock", label: "Stock", icon: Package, permissions: ["stock"] },
  { key: "issue", label: "Issue to Machine", icon: ArrowRightFromLine, permissions: ["issue.cutter", "issue.holo", "issue.coning"] },
  { key: "receive", label: "Receive from Machine", icon: ArrowLeftToLine, permissions: ["receive.cutter", "receive.holo", "receive.coning"] },
  { key: "dispatch", label: "Dispatch", icon: Truck, permissions: ["dispatch"] },
  { key: "opening-stock", label: "Opening Stock", icon: ClipboardPlus, permissions: ["opening_stock"] },
  { key: "box-transfer", label: "Box Transfer", icon: ArrowRightLeft, permissions: ["box_transfer"] },
  { key: "boiler", label: "Boiler (Steaming)", icon: Flame, process: "holo", permissions: ["boiler"] },
  { key: "send-documents", label: "Send Documents", icon: FileText, permissions: ["send_documents"] },
  { key: "masters", label: "Masters", icon: Database, permissions: ["masters"] },
  { key: "reports", label: "Reports", icon: BarChart3, permissions: ["reports"] },
  { key: "settings", label: "Settings", icon: Settings, permissions: ["settings"] },
];

export default function DashboardLayout() {
  const { brand, theme, setTheme, process, setProcess } = useInventory();
  const { user } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();

  const processDef = getProcessDefinition(process);
  const processOptions = Object.values(PROCESS_DEFINITIONS);

  const toggleTheme = () => setTheme(prev => prev === "dark" ? "light" : "dark");

  // Close sidebar on desktop view to prevent stuck overlay
  React.useEffect(() => {
    const media = window.matchMedia("(min-width: 768px)");
    const handler = (e) => {
      if (e.matches) {
        setSidebarOpen(false);
      }
    };
    // Initial check
    if (media.matches) {
      setSidebarOpen(false);
    }
    media.addEventListener("change", handler);
    return () => media.removeEventListener("change", handler);
  }, []);

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      <div className="p-6 flex items-center gap-3 border-b border-border/50">
        <div className="h-10 w-10 rounded-lg bg-white grid place-items-center overflow-hidden border border-border shadow-sm">
          {brand.logoDataUrl ? (
            <img src={brand.logoDataUrl} alt="Logo" className="h-8 w-8 object-contain" />
          ) : (
            <Factory className="h-6 w-6 text-slate-800" />
          )}
        </div>
        <div>
          <h1 className="font-bold text-lg leading-tight">GLINTEX</h1>
          <p className="text-xs text-muted-foreground">Inventory System</p>
        </div>
      </div>

      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        {NAV_ITEMS
          .filter(item => !item.process || item.process === process)
          .map((item) => {
            const isAdmin = !!user?.isAdmin;
            const permissionList = Array.isArray(item.permissions) ? item.permissions : [];
            const levels = permissionList.map(key => getPermissionLevel(user?.permissions || {}, key));
            const maxLevel = isAdmin ? ACCESS_LEVELS.WRITE : (levels.length ? Math.max(...levels) : ACCESS_LEVELS.READ);
            if (!isAdmin && maxLevel <= ACCESS_LEVELS.NONE) return null;
            const Icon = item.icon;
            return (
              <NavLink
                key={item.key}
                to={`/app/${item.key}`}
                onClick={() => setSidebarOpen(false)}
                className={({ isActive }) => cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
              >
                <Icon className="h-4 w-4" />
                <span className="flex items-center gap-2">
                  {item.label}
                  {maxLevel === ACCESS_LEVELS.READ && (
                    <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                </span>
              </NavLink>
            );
          })}
      </nav>

      <div className="p-4 border-t border-border/50 space-y-4">
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">Active Process</label>
          <Select
            value={process}
            onChange={(e) => setProcess(e.target.value)}
            className="h-8 text-xs"
          >
            {processOptions.map(opt => (
              <option key={opt.id} value={opt.id}>{opt.label}</option>
            ))}
          </Select>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Theme</span>
          <Button variant="ghost" size="icon" onClick={toggleTheme} className="h-8 w-8">
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background flex">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex w-64 flex-col border-r border-border bg-card/50 backdrop-blur-sm fixed inset-y-0 left-0 z-30">
        <SidebarContent />
      </aside>

      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm md:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Mobile Sidebar Drawer */}
      <div className={cn(
        "fixed inset-y-0 left-0 z-50 w-64 bg-card border-r border-border transition-transform duration-200 ease-in-out md:hidden",
        sidebarOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <SidebarContent />
      </div>

      {/* Main Content */}
      <main className="flex-1 md:ml-64 flex flex-col min-h-screen transition-all duration-200 ease-in-out">
        {/* Mobile Header */}
        <header className="md:hidden h-14 border-b border-border flex items-center justify-between px-4 bg-card/80 backdrop-blur sticky top-0 z-20">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(true)}>
              <Menu className="h-5 w-5" />
            </Button>
            <span className="font-semibold">GLINTEX</span>
          </div>
        </header>

        {/* Content Area */}
        {/* NOTE: Avoid overflow clipping here; it breaks dropdowns/menus on smaller screens. */}
        <div className="flex-1 p-4 sm:p-6 md:p-8 max-w-7xl mx-auto w-full min-w-0">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
