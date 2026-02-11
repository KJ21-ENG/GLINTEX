import React, { useState, useRef, useCallback, useEffect } from "react";
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
  Moon,
  Sun,
  Factory,
  ClipboardPlus,
  Flame,
  Lock,
  FileText,
  RefreshCw
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

const SIDEBAR_MIN_WIDTH = 64;
const SIDEBAR_MAX_WIDTH = 256;
const SIDEBAR_EXPAND_THRESHOLD = 120; // Width threshold to show/hide text labels

export default function DashboardLayout() {
  const { brand, theme, setTheme, process, setProcess } = useInventory();
  const { user } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_MIN_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia("(min-width: 768px)").matches);
  const [processMenuPos, setProcessMenuPos] = useState(null); // null = closed, {top, left} = open
  const processMenuRef = useRef(null);
  const sidebarRef = useRef(null);
  const location = useLocation();

  const isExpanded = sidebarWidth >= SIDEBAR_EXPAND_THRESHOLD;

  const processDef = getProcessDefinition(process);
  const processOptions = Object.values(PROCESS_DEFINITIONS);

  const toggleTheme = () => setTheme(prev => prev === "dark" ? "light" : "dark");

  // Close process menu on outside click
  useEffect(() => {
    if (!processMenuPos) return;
    const handleClickOutside = (e) => {
      if (processMenuRef.current && !processMenuRef.current.contains(e.target)) {
        setProcessMenuPos(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [processMenuPos]);

  // Toggle sidebar between collapsed and expanded on logo click
  const toggleSidebar = useCallback(() => {
    setSidebarWidth(prev =>
      prev >= SIDEBAR_MAX_WIDTH ? SIDEBAR_MIN_WIDTH : SIDEBAR_MAX_WIDTH
    );
  }, []);

  // --- Drag-to-resize logic ---
  const handleMouseDown = useCallback((e) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e) => {
      const newWidth = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, e.clientX));
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = (e) => {
      setIsResizing(false);
      // Snap to collapsed or expanded based on threshold
      const finalWidth = e.clientX;
      if (finalWidth < SIDEBAR_EXPAND_THRESHOLD) {
        setSidebarWidth(SIDEBAR_MIN_WIDTH);
      } else {
        setSidebarWidth(SIDEBAR_MAX_WIDTH);
      }
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    // Prevent text selection while dragging
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [isResizing]);

  // Track desktop/mobile breakpoint and close mobile sidebar on desktop
  useEffect(() => {
    const media = window.matchMedia("(min-width: 768px)");
    const handler = (e) => {
      setIsDesktop(e.matches);
      if (e.matches) {
        setSidebarOpen(false);
      }
    };
    setIsDesktop(media.matches);
    if (media.matches) {
      setSidebarOpen(false);
    }
    media.addEventListener("change", handler);
    return () => media.removeEventListener("change", handler);
  }, []);

  // --- Sidebar Tooltip wrapper (CSS-positioned tooltip on hover) ---
  const SidebarTooltip = ({ label, children }) => (
    <div className="relative group/tooltip" style={{ overflow: 'visible' }}>
      {children}
      <div
        className="fixed ml-2 px-2.5 py-1.5 rounded-md bg-popover border border-border text-popover-foreground text-xs font-medium whitespace-nowrap shadow-md opacity-0 pointer-events-none group-hover/tooltip:opacity-100 transition-opacity duration-150"
        style={{ zIndex: 9999, left: `${sidebarWidth + 4}px`, position: 'fixed', top: 'auto', transform: 'translateY(-50%)' }}
        ref={(el) => {
          // Position the tooltip vertically relative to its trigger
          if (el) {
            const parent = el.parentElement;
            if (parent) {
              const rect = parent.getBoundingClientRect();
              el.style.top = `${rect.top + rect.height / 2}px`;
            }
          }
        }}
      >
        {label}
      </div>
    </div>
  );

  // --- Desktop Sidebar Content (collapsible) ---
  const DesktopSidebarContent = () => (
    <div className="flex flex-col h-full">
      {/* Logo / Header — click to toggle */}
      <div
        className={cn(
          "flex items-center border-b border-border/50 cursor-pointer select-none hover:bg-accent/50 transition-colors",
          isExpanded ? "p-6 gap-3" : "p-3 justify-center"
        )}
        onClick={toggleSidebar}
      >
        {!isExpanded ? (
          <SidebarTooltip label="Expand sidebar">
            <div className="h-9 w-9 rounded-lg bg-white grid place-items-center overflow-hidden border border-border shadow-sm flex-shrink-0">
              {brand.logoDataUrl ? (
                <img src={brand.logoDataUrl} alt="Logo" className="h-6 w-6 object-contain" />
              ) : (
                <Factory className="h-5 w-5 text-slate-800" />
              )}
            </div>
          </SidebarTooltip>
        ) : (
          <>
            <div className="h-10 w-10 rounded-lg bg-white grid place-items-center overflow-hidden border border-border shadow-sm flex-shrink-0">
              {brand.logoDataUrl ? (
                <img src={brand.logoDataUrl} alt="Logo" className="h-8 w-8 object-contain" />
              ) : (
                <Factory className="h-6 w-6 text-slate-800" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="font-bold text-lg leading-tight truncate">GLINTEX</h1>
              <p className="text-xs text-muted-foreground truncate">Inventory System</p>
            </div>
          </>
        )}
      </div>

      {/* Navigation */}
      <nav className={cn(
        "flex-1 overflow-y-auto space-y-1",
        isExpanded ? "p-4" : "p-2"
      )}>
        {NAV_ITEMS
          .filter(item => !item.process || item.process === process)
          .map((item) => {
            const isAdmin = !!user?.isAdmin;
            const permissionList = Array.isArray(item.permissions) ? item.permissions : [];
            const levels = permissionList.map(key => getPermissionLevel(user?.permissions || {}, key));
            const maxLevel = isAdmin ? ACCESS_LEVELS.WRITE : (levels.length ? Math.max(...levels) : ACCESS_LEVELS.READ);
            if (!isAdmin && maxLevel <= ACCESS_LEVELS.NONE) return null;
            const Icon = item.icon;

            const navLink = (
              <NavLink
                key={item.key}
                to={`/app/${item.key}`}
                className={({ isActive }) => cn(
                  "flex items-center rounded-md text-sm font-medium transition-colors",
                  isExpanded ? "gap-3 px-3 py-2.5" : "justify-center px-2 py-2.5",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
              >
                <Icon className="h-4 w-4 flex-shrink-0" />
                {isExpanded && (
                  <span className="flex items-center gap-2 truncate">
                    {item.label}
                    {maxLevel === ACCESS_LEVELS.READ && (
                      <Lock className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                    )}
                  </span>
                )}
              </NavLink>
            );

            if (!isExpanded) {
              return (
                <SidebarTooltip key={item.key} label={item.label}>
                  {navLink}
                </SidebarTooltip>
              );
            }
            return navLink;
          })}
      </nav>

      {/* Footer controls — only when expanded */}
      {isExpanded && (
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
      )}

      {/* Collapsed footer — process switcher + theme toggle */}
      {!isExpanded && (
        <div className="p-2 border-t border-border/50 flex flex-col items-center gap-1">
          <div className="relative" ref={processMenuRef}>
            <SidebarTooltip label={!processMenuPos ? `Process: ${processDef?.label || process}` : ""}>
              <Button
                variant="ghost"
                size="icon"
                onClick={(e) => {
                  e.stopPropagation();
                  if (processMenuPos) {
                    setProcessMenuPos(null);
                  } else {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setProcessMenuPos({
                      left: rect.right + 8,
                      bottom: window.innerHeight - rect.bottom,
                    });
                  }
                }}
                className="h-8 w-8"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </SidebarTooltip>
            {/* Process selection popover */}
            {processMenuPos && (
              <div
                className="fixed rounded-lg bg-popover border border-border shadow-lg py-1 min-w-[160px]"
                style={{
                  zIndex: 9999,
                  left: `${processMenuPos.left}px`,
                  bottom: `${processMenuPos.bottom}px`,
                }}
              >
                <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground border-b border-border mb-1">
                  Select Process
                </div>
                {processOptions.map(opt => (
                  <button
                    key={opt.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      setProcess(opt.id);
                      setProcessMenuPos(null);
                    }}
                    className={cn(
                      "w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors",
                      process === opt.id ? "bg-primary/10 text-primary font-medium" : "text-foreground"
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <SidebarTooltip label="Toggle theme">
            <Button variant="ghost" size="icon" onClick={toggleTheme} className="h-8 w-8">
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
          </SidebarTooltip>
        </div>
      )}
    </div>
  );

  // --- Mobile Sidebar Content (always full-width) ---
  const MobileSidebarContent = () => (
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
      <aside
        ref={sidebarRef}
        className="hidden md:flex flex-col border-r border-border bg-card/50 backdrop-blur-sm fixed inset-y-0 left-0 z-30"
        style={{
          width: `${sidebarWidth}px`,
          transition: isResizing ? "none" : "width 200ms ease-in-out",
        }}
      >
        <DesktopSidebarContent />

        {/* Resize handle */}
        <div
          className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize group z-40 hover:bg-primary/20 active:bg-primary/30 transition-colors"
          onMouseDown={handleMouseDown}
        >
          <div className="absolute top-1/2 -translate-y-1/2 right-0 w-1 h-8 rounded-full bg-border group-hover:bg-primary/50 transition-colors" />
        </div>
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
        <MobileSidebarContent />
      </div>

      {/* Main Content */}
      <main
        className="flex-1 flex flex-col min-h-screen"
        style={{
          marginLeft: isDesktop ? `${sidebarWidth}px` : undefined,
          transition: isResizing ? "none" : "margin-left 200ms ease-in-out",
        }}
      >

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
        <div className="flex-1 p-4 sm:p-6 md:py-8 md:pr-8 md:pl-4 max-w-7xl mx-auto w-full min-w-0">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
