/**
 * ColumnFilter: reusable trigger with icon + popover menu for column-level filters
 */

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useBrand } from '../../context';
import { Popover } from './Popover.jsx';

const PORTAL_ID = 'glintex-column-filter-root';

function ensurePortalNode() {
  if (typeof document === 'undefined') return null;
  let node = document.getElementById(PORTAL_ID);
  if (!node) {
    node = document.createElement('div');
    node.id = PORTAL_ID;
    document.body.appendChild(node);
  }
  return node;
}

export function ColumnFilter({ active = false, title = 'Filter column', align = 'right', children }) {
  const { cls } = useBrand();
  const [open, setOpen] = useState(false);
  const popoverRef = useRef(null);
  const triggerRef = useRef(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const portalNode = useMemo(() => ensurePortalNode(), []);

  useEffect(() => {
    if (!open) return undefined;
    function onDocClick(e) {
      if (popoverRef.current?.contains(e.target)) return;
      if (triggerRef.current?.contains(e.target)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  useEffect(() => {
    function onEsc(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    if (open) {
      document.addEventListener('keydown', onEsc);
      return () => document.removeEventListener('keydown', onEsc);
    }
    return undefined;
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return undefined;
    function updatePosition() {
      const trigger = triggerRef.current;
      const pop = popoverRef.current;
      if (!trigger || !pop) return;
      const triggerBox = trigger.getBoundingClientRect();
      const popBox = pop.getBoundingClientRect();
      const margin = 8;
      let left;
      if (align === 'left') {
        left = triggerBox.left;
      } else if (align === 'center') {
        left = triggerBox.left + (triggerBox.width / 2) - (popBox.width / 2);
      } else {
        left = triggerBox.right - popBox.width;
      }
      // keep within viewport with margin
      left = Math.min(Math.max(left, margin), window.innerWidth - popBox.width - margin);
      const top = triggerBox.bottom + 6;
      setPosition({ top: top + window.scrollY, left: left + window.scrollX });
    }
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, align]);

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        onClick={() => setOpen(o => !o)}
        className={`ml-1 w-6 h-6 rounded-md border ${cls.cardBorder} ${cls.cardBg} flex items-center justify-center transition ${active ? 'text-[var(--brand-primary)] border-[var(--brand-primary)]' : `${cls.navHover}`}`}
        title={title}
        aria-label={title}
        aria-expanded={open}
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
          <path d="M3 5a1 1 0 0 1 1-1h12a1 1 0 0 1 .78 1.63l-4.3 5.16a1 1 0 0 0-.24.65v2.18a1 1 0 0 1-.4.8l-2 1.5A1 1 0 0 1 8 15.5v-3.06a1 1 0 0 0-.24-.65L3.22 5.63A1 1 0 0 1 3 5Z" />
        </svg>
      </button>
      {open && portalNode && createPortal(
        <div
          ref={popoverRef}
          style={{ position: 'absolute', top: position.top, left: position.left, zIndex: 1000 }}
        >
          <Popover className={`border ${cls.cardBorder} ${cls.cardBg} shadow-lg`} style={{ minWidth: 240 }}>
            {typeof children === 'function' ? children({ close: () => setOpen(false) }) : children}
          </Popover>
        </div>,
        portalNode
      )}
    </>
  );
}

export default ColumnFilter;
