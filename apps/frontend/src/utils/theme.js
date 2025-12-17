/**
 * Theme utilities for GLINTEX Inventory
 */

export const THEME_KEY = "glintex_theme";

export const defaultBrand = {
  primary: "#2E4CA6",
  gold: "#D4AF37",
  logoDataUrl: "",
  faviconDataUrl: "",
};

export function themeClasses(theme) {
  const dark = theme === "dark";
  const baseText = dark ? "text-white" : "text-slate-900";
  const headerBg = dark ? "bg-slate-900/60 border-white/10" : "bg-white/80 border-slate-200";
  const cardBg = dark ? "bg-white/5" : "bg-white";
  const cardBorder = dark ? "border-white/10" : "border-slate-200";
  const input = dark ? "bg-white/10 border-white/15 text-white placeholder-white/50" : "bg-white border-slate-300 text-slate-900 placeholder-slate-400";
  const muted = dark ? "text-white/70" : "text-slate-600";
  const rowBorder = dark ? "border-white/10" : "border-slate-200";
  const pill = dark ? "bg-white/10 border-white/10" : "bg-slate-100 border-slate-200";
  const navActive = dark ? "bg-white/15 border-white/20" : "bg-slate-100 border-slate-300";
  const navHover = dark ? "hover:bg-white/5" : "hover:bg-slate-100";
  return { baseText, headerBg, cardBg, cardBorder, input, muted, rowBorder, pill, navActive, navHover };
}
