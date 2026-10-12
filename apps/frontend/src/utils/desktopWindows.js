// Several windows of the GLINTEX desktop app, the way staff used browser tabs. In a
// browser these helpers do nothing: Ctrl+click and middle click already open a tab.
export const hasDesktopWindows = () =>
  typeof window !== 'undefined' && typeof window.glintexDesktop?.windows?.open === 'function';

export const openDesktopWindow = (path = '/') => window.glintexDesktop.windows.open(path);

export const currentAppPath = () => `${window.location.pathname}${window.location.search}`;

// Ctrl/Cmd+click or a middle click on a navigation item asks for another window.
export const wantsNewWindow = (event) =>
  !!event && (event.button === 1 || ((event.ctrlKey || event.metaKey) && event.button === 0));

export const openInNewWindowIfRequested = (event, path) => {
  if (!hasDesktopWindows() || !wantsNewWindow(event)) return false;
  event.preventDefault();
  if (typeof event.stopPropagation === 'function') event.stopPropagation();
  openDesktopWindow(path).catch((error) => window.alert(error?.message || 'Could not open another window'));
  return true;
};
