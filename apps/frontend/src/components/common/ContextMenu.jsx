import React from 'react';
import ReactDOM from 'react-dom';
import { useBrand } from '../../context';

export function ContextMenu({ x, y, open, onClose, children }) {
  const { cls, theme } = useBrand();
  const menuRef = React.useRef(null);
  const [pos, setPos] = React.useState({ x: 0, y: 0 });

  React.useEffect(() => {
    if (!open) return undefined;
    // initialize at requested coords
    setPos({ x: x || 0, y: y || 0 });
    function handleDocClick(e) {
      if (menuRef.current && menuRef.current.contains(e.target)) return;
      onClose && onClose();
    }
    function handleKeyDown(e) {
      if (e.key === 'Escape' || e.key === 'Esc') {
        onClose && onClose();
      }
    }

    function handleResize() { onClose && onClose(); }
    function handleScroll() { onClose && onClose(); }

    document.addEventListener('mousedown', handleDocClick);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleResize);
    // capture scroll events so any scroll closes the menu
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('mousedown', handleDocClick);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [open, x, y, onClose]);

  // adjust to keep inside viewport after first render
  React.useLayoutEffect(() => {
    if (!open || !menuRef.current) return undefined;
    const rect = menuRef.current.getBoundingClientRect();
    const margin = 8;
    const adjustedLeft = Math.min(Math.max(margin, pos.x), Math.max(margin, window.innerWidth - rect.width - margin));
    const adjustedTop = Math.min(Math.max(margin, pos.y), Math.max(margin, window.innerHeight - rect.height - margin));
    if (adjustedLeft !== pos.x || adjustedTop !== pos.y) {
      setPos({ x: adjustedLeft, y: adjustedTop });
    }
    return undefined;
  }, [open, pos.x, pos.y]);

  if (!open) return null;

  const containerClasses = `rounded-md border ${cls.cardBorder} ${theme === 'dark' ? 'bg-slate-800 text-white' : 'bg-white text-slate-900'} shadow-lg p-1`;

  const style = {
    position: 'fixed',
    left: Math.round(Math.max(4, pos.x)),
    top: Math.round(Math.max(4, pos.y)),
    zIndex: 9999,
    minWidth: 140,
  };

  const node = (
    <div ref={menuRef} tabIndex={-1} style={style} className={containerClasses} onContextMenu={(e) => e.preventDefault()}>
      {children}
    </div>
  );

  return ReactDOM.createPortal(node, document.body);
}

export default ContextMenu;


