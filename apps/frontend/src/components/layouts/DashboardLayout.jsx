import React, { useState } from "react";
import { Outlet, NavLink, useLocation } from "react-router-dom";
import { 
  PackagePlus, 
  Package, 
  ArrowRightFromLine, 
  ArrowLeftToLine, 
  Database, 
  BarChart3, 
  Settings, 
  Menu, 
  X,
  Moon,
  Sun,
  Factory
} from "lucide-react";
import { useInventory } from "../../context/InventoryContext";
import { Button, Select } from "../ui";
import { cn } from "../../lib/utils";
import { getProcessDefinition, PROCESS_DEFINITIONS } from "../../constants/processes";

const NAV_ITEMS = [
  { key: "inbound", label: "Inbound", icon: PackagePlus },
  { key: "stock", label: "Stock", icon: Package },
  { key: "issue", label: "Issue to Machine", icon: ArrowRightFromLine },
  { key: "receive", label: "Receive from Machine", icon: ArrowLeftToLine },
  { key: "masters", label: "Masters", icon: Database },
  { key: "reports", label: "Reports", icon: BarChart3 },
  { key: "settings", label: "Settings", icon: Settings },
];

export default function DashboardLayout() {
  const { brand, theme, setTheme, process, setProcess } = useInventory();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  
  const processDef = getProcessDefinition(process);
  const processOptions = Object.values(PROCESS_DEFINITIONS);

  const toggleTheme = () => setTheme(prev => prev === "dark" ? "light" : "dark");

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
        {NAV_ITEMS.map((item) => {
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
              {item.label}
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
      <main className="flex-1 md:ml-64 flex flex-col min-h-screen">
        {/* Mobile Header */}
        <header className="md:hidden h-16 border-b border-border flex items-center justify-between px-4 bg-card/50 backdrop-blur sticky top-0 z-20">
            <div className="flex items-center gap-3">
                <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(true)}>
                    <Menu className="h-5 w-5" />
                </Button>
                <span className="font-semibold">GLINTEX</span>
            </div>
        </header>

        {/* Content Area */}
        <div className="flex-1 p-4 md:p-8 max-w-7xl mx-auto w-full">
            <Outlet />
        </div>
      </main>
    </div>
  );
}
