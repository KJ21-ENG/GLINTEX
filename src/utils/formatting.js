/**
 * Formatting utilities for GLINTEX Inventory
 */

export function formatKg(n) { 
  if (n == null || Number.isNaN(n)) return "0.000"; 
  return Number(n).toFixed(3); 
}

export function uid(prefix = "id") { 
  return `${prefix}_${Math.random().toString(36).slice(2,8)}${Date.now().toString(36).slice(-4)}`; 
}

export function todayISO() { 
  return new Date().toISOString().slice(0,10); 
}

export function yyyymmdd(dateISO) { 
  return dateISO.replaceAll("-", ""); 
}
