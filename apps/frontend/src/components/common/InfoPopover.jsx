import React, { useEffect, useRef, useState } from 'react';
import { Info, ArrowRight } from 'lucide-react';
import { Button } from '../ui';

/**
 * Generic info popover used for lightweight hover/click tooltips with an (i) trigger.
 * Mirrors the behavior that was previously hardcoded inside the stock LotPopover.
 */
export function InfoPopover({
  title = 'Info',
  items = [],
  renderItem,
  renderContent,
  emptyText = 'No items.',
  onAction,
  actionLabel = 'Apply',
  widthClassName = 'w-64',
  bodyClassName = 'max-h-[200px] overflow-y-auto text-sm space-y-1',
  buttonClassName = 'h-6 w-6 rounded-full hover:bg-muted',
  align = 'left', // 'left' or 'right' - controls horizontal alignment
}) {
  const [isOpen, setIsOpen] = useState(false);
  const popoverRef = useRef(null);
  const closeTimeoutRef = useRef(null);

  const handleMouseEnter = () => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
    setIsOpen(true);
  };

  const handleMouseLeave = () => {
    closeTimeoutRef.current = setTimeout(() => {
      setIsOpen(false);
    }, 150);
  };

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
    };
  }, []);

  const list = items || [];

  return (
    <div
      className="relative inline-block"
      ref={popoverRef}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <Button
        variant="ghost"
        size="icon"
        className={buttonClassName}
        onClick={(e) => {
          e.stopPropagation();
          if (!isOpen) handleMouseEnter();
          else setIsOpen(false);
        }}
      >
        <Info className="h-4 w-4 text-primary" />
      </Button>

      {isOpen && (
        <div
          className={`absolute ${align === 'right' ? 'right-0' : 'left-0'} top-full mt-2 z-50 ${widthClassName} rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none animate-in fade-in-0 zoom-in-95`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex justify-between items-center mb-2">
            <h4 className="font-medium leading-none">{title}</h4>
            {onAction && (
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                title={actionLabel}
                onClick={() => {
                  onAction(list);
                  setIsOpen(false);
                }}
              >
                <ArrowRight className="h-4 w-4" />
              </Button>
            )}
          </div>
          <div className={bodyClassName}>
            {list.length === 0 ? (
              <div className="text-muted-foreground">{emptyText}</div>
            ) : renderContent ? (
              renderContent(list)
            ) : (
              list.map((item, i) => (
                <div key={i} className="text-muted-foreground border-b last:border-0 py-1">
                  {renderItem ? renderItem(item, i) : item}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
