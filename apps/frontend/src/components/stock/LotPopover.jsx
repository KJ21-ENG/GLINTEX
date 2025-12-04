import React, { useState, useEffect, useRef } from 'react';
import { Button } from '../ui';
import { Info, ArrowRight } from 'lucide-react';

export function LotPopover({ lots, onApplyFilter }) {
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
                className="h-6 w-6 rounded-full hover:bg-muted"
                onClick={(e) => {
                    e.stopPropagation();
                    // Toggle open/close on click, clearing timeout if opening
                    if (!isOpen) handleMouseEnter();
                    else setIsOpen(false);
                }}
            >
                <Info className="h-4 w-4 text-primary" />
            </Button>

            {isOpen && (
                <div
                    className="absolute left-0 top-full mt-2 z-50 w-64 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none animate-in fade-in-0 zoom-in-95"
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="flex justify-between items-center mb-2">
                        <h4 className="font-medium leading-none">Associated Lots</h4>
                        <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6"
                            title="Filter by these lots"
                            onClick={() => {
                                onApplyFilter(lots);
                                setIsOpen(false);
                            }}
                        >
                            <ArrowRight className="h-4 w-4" />
                        </Button>
                    </div>
                    <div className="max-h-[200px] overflow-y-auto text-sm space-y-1">
                        {lots.map((lot, i) => (
                            <div key={i} className="text-muted-foreground border-b last:border-0 py-1">
                                {lot}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
