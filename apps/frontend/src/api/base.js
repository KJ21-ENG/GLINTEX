export function getApiBase() {
  if (import.meta.env?.VITE_API_BASE) return import.meta.env.VITE_API_BASE.replace(/\/$/, '');
  if (typeof window !== 'undefined' && window.location) {
    if (!import.meta.env?.DEV) return window.location.origin;
    return `${window.location.protocol}//${window.location.hostname}:4000`;
  }
  return 'http://localhost:4000';
}

export const API_BASE = getApiBase();
