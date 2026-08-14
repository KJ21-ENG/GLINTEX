import React, { useEffect, useRef, useState } from 'react';
import { Button } from '../ui';
import { formatKg } from '../../utils';

export const RECEIVE_SUMMARY_SCALE_STORAGE_KEY = 'glintex.receiveIssueSummaryScale.v1';
export const LEGACY_CONING_SUMMARY_SCALE_STORAGE_KEY = 'glintex.coningSummaryScale.v1';
export const RECEIVE_SUMMARY_SCALE_MIN = 0.9;
export const RECEIVE_SUMMARY_SCALE_MAX = 1.6;
export const RECEIVE_SUMMARY_SCALE_DEFAULT = 1;
export const RECEIVE_SUMMARY_OVER_ISSUED_EPSILON_KG = 0.001;

function clampReceiveSummaryScale(value) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return RECEIVE_SUMMARY_SCALE_DEFAULT;
    return Math.min(RECEIVE_SUMMARY_SCALE_MAX, Math.max(RECEIVE_SUMMARY_SCALE_MIN, numericValue));
}

function readReceiveSummaryScale() {
    if (typeof window === 'undefined') return RECEIVE_SUMMARY_SCALE_DEFAULT;
    try {
        const storedValue = window.localStorage.getItem(RECEIVE_SUMMARY_SCALE_STORAGE_KEY);
        if (storedValue != null && storedValue.trim() !== '') {
            return clampReceiveSummaryScale(storedValue);
        }

        const legacyValue = window.localStorage.getItem(LEGACY_CONING_SUMMARY_SCALE_STORAGE_KEY);
        if (legacyValue == null || legacyValue.trim() === '') return RECEIVE_SUMMARY_SCALE_DEFAULT;
        return clampReceiveSummaryScale(legacyValue);
    } catch {
        return RECEIVE_SUMMARY_SCALE_DEFAULT;
    }
}

export function ReceiveSummaryMetricCard({ label, value, unit, action, detail, valueClassName = '' }) {
    return (
        <div
            className="min-w-0 rounded-lg border border-border/70 bg-background/50"
            style={{
                padding: 'var(--receive-summary-card-padding)',
                lineHeight: 'var(--receive-summary-line-height)',
            }}
        >
            <div
                className="break-words font-medium uppercase tracking-wide text-muted-foreground"
                style={{
                    fontSize: 'var(--receive-summary-label-size)',
                    lineHeight: '1.25',
                }}
            >
                {label}
            </div>
            <div
                className="flex min-w-0 flex-wrap items-baseline"
                style={{
                    marginTop: 'var(--receive-summary-card-value-offset)',
                    columnGap: 'var(--receive-summary-inline-gap)',
                    rowGap: 'var(--receive-summary-inline-gap)',
                    lineHeight: '1.15',
                }}
            >
                <span
                    className={`min-w-0 break-words font-semibold ${valueClassName}`}
                    style={{ fontSize: 'var(--receive-summary-value-size)' }}
                >
                    {value}
                </span>
                {unit && (
                    <span
                        className="break-words text-muted-foreground"
                        style={{ fontSize: 'var(--receive-summary-unit-size)' }}
                    >
                        {unit}
                    </span>
                )}
                {action}
            </div>
            {detail && (
                <div
                    className="break-words text-muted-foreground"
                    style={{
                        marginTop: 'var(--receive-summary-detail-offset)',
                        fontSize: 'var(--receive-summary-detail-size)',
                        lineHeight: '1.25',
                    }}
                >
                    {detail}
                </div>
            )}
        </div>
    );
}

export function ReceiveSummaryGroup({ id, title, metrics, children }) {
    return (
        <section
            aria-labelledby={id}
            className="grid min-w-0"
            style={{ rowGap: 'var(--receive-summary-group-gap)' }}
        >
            <h3
                id={id}
                className="font-semibold uppercase tracking-[0.08em] text-muted-foreground"
                style={{
                    fontSize: 'var(--receive-summary-heading-size)',
                    lineHeight: '1.25',
                }}
            >
                {title}
            </h3>
            {children || (
                <div
                    className="min-w-0"
                    style={receiveSummaryMetricGridStyle}
                >
                    {(metrics || []).map((metric, index) => (
                        <ReceiveSummaryMetricCard key={metric.id || `${id}-metric-${index}`} {...metric} />
                    ))}
                </div>
            )}
        </section>
    );
}

export const receiveSummaryMetricGridStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(var(--receive-summary-card-min), 100%), 1fr))',
    gap: 'var(--receive-summary-gap)',
};

export function ResizableIssueSummary({ idPrefix, groups = [], warning = null, children }) {
    const [summaryScale, setSummaryScale] = useState(readReceiveSummaryScale);
    const summaryScaleRef = useRef(summaryScale);
    const summaryResizeRef = useRef(null);

    useEffect(() => {
        summaryScaleRef.current = summaryScale;
        if (typeof window === 'undefined') return;
        try {
            window.localStorage.setItem(RECEIVE_SUMMARY_SCALE_STORAGE_KEY, String(summaryScale));
        } catch {
            // Storage can be unavailable in private browsing or restricted webviews.
        }
    }, [summaryScale]);

    useEffect(() => () => {
        const activeResize = summaryResizeRef.current;
        if (activeResize?.element?.hasPointerCapture?.(activeResize.pointerId)) {
            activeResize.element.releasePointerCapture(activeResize.pointerId);
        }
        summaryResizeRef.current = null;
    }, []);

    const updateSummaryScale = (nextValue) => {
        setSummaryScale((previousValue) => {
            const resolvedValue = typeof nextValue === 'function' ? nextValue(previousValue) : nextValue;
            const nextScale = clampReceiveSummaryScale(resolvedValue);
            summaryScaleRef.current = nextScale;
            return nextScale;
        });
    };

    const adjustSummaryScale = (delta) => {
        updateSummaryScale((currentScale) => currentScale + delta);
    };

    const handleSummaryResizePointerDown = (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        const element = event.currentTarget;
        element.setPointerCapture?.(event.pointerId);
        summaryResizeRef.current = {
            element,
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            startScale: summaryScaleRef.current,
        };
    };

    const handleSummaryResizePointerMove = (event) => {
        const activeResize = summaryResizeRef.current;
        if (!activeResize || activeResize.pointerId !== event.pointerId) return;
        event.preventDefault();
        const diagonalDelta = ((event.clientX - activeResize.startX) + (event.clientY - activeResize.startY)) / 2;
        updateSummaryScale(activeResize.startScale + diagonalDelta / 250);
    };

    const finishSummaryResize = (event) => {
        const activeResize = summaryResizeRef.current;
        if (!activeResize || activeResize.pointerId !== event.pointerId) return;
        if (activeResize.element?.hasPointerCapture?.(event.pointerId)) {
            activeResize.element.releasePointerCapture(event.pointerId);
        }
        summaryResizeRef.current = null;
    };

    const handleSummaryResizeKeyDown = (event) => {
        switch (event.key) {
            case 'ArrowLeft':
            case 'ArrowDown':
                event.preventDefault();
                adjustSummaryScale(-0.05);
                break;
            case 'ArrowRight':
            case 'ArrowUp':
                event.preventDefault();
                adjustSummaryScale(0.05);
                break;
            case 'Home':
                event.preventDefault();
                updateSummaryScale(RECEIVE_SUMMARY_SCALE_MIN);
                break;
            case 'End':
                event.preventDefault();
                updateSummaryScale(RECEIVE_SUMMARY_SCALE_MAX);
                break;
            case 'r':
            case 'R':
                event.preventDefault();
                updateSummaryScale(RECEIVE_SUMMARY_SCALE_DEFAULT);
                break;
            default:
                break;
        }
    };

    const summaryScalePercent = Math.round(summaryScale * 100);
    const summaryStyle = {
        '--receive-summary-font-size': `${summaryScale}rem`,
        '--receive-summary-line-height': `${1.5 * summaryScale}rem`,
        '--receive-summary-gap': `${Math.max(0.75, Math.min(1.5, 0.9 * summaryScale))}rem`,
        '--receive-summary-group-gap': `${Math.max(0.4, Math.min(0.9, 0.55 * summaryScale))}rem`,
        '--receive-summary-inline-gap': `${Math.max(0.25, Math.min(0.7, 0.4 * summaryScale))}rem`,
        '--receive-summary-padding': `${Math.max(0.8, Math.min(1.6, 1 * summaryScale))}rem`,
        '--receive-summary-card-padding': `${Math.max(0.7, Math.min(1.3, 0.8 * summaryScale))}rem`,
        '--receive-summary-card-value-offset': `${Math.max(0.2, Math.min(0.45, 0.3 * summaryScale))}rem`,
        '--receive-summary-detail-offset': `${Math.max(0.25, Math.min(0.55, 0.35 * summaryScale))}rem`,
        '--receive-summary-card-min': `${Math.max(8.5, Math.min(16, 10 * summaryScale))}rem`,
        '--receive-summary-heading-size': `${Math.max(0.9, Math.min(1.45, 1 * summaryScale))}rem`,
        '--receive-summary-label-size': `${Math.max(0.875, Math.min(1.5, 1 * summaryScale))}rem`,
        '--receive-summary-value-size': `${Math.max(1.1, Math.min(2.25, 1.35 * summaryScale))}rem`,
        '--receive-summary-unit-size': `${Math.max(0.85, Math.min(1.35, 0.95 * summaryScale))}rem`,
        '--receive-summary-detail-size': `${Math.max(0.8, Math.min(1.25, 0.9 * summaryScale))}rem`,
    };
    const summaryId = idPrefix || 'receive-summary';
    const excessReceivedWeight = Number(warning?.excessKg || 0);

    return (
        <div
            id={summaryId}
            className="w-full max-w-full min-w-0 rounded-xl border border-border/60 bg-muted/60"
            style={{
                ...summaryStyle,
                display: 'grid',
                width: 'min(100%, calc(100vw - 3rem))',
                maxWidth: '100%',
                rowGap: 'var(--receive-summary-gap)',
                padding: 'var(--receive-summary-padding)',
                fontSize: 'var(--receive-summary-font-size)',
                lineHeight: 'var(--receive-summary-line-height)',
            }}
        >
            {groups.map((group, index) => (
                <ReceiveSummaryGroup
                    key={group.id || `${summaryId}-group-${index}`}
                    id={`${summaryId}-${group.id || `group-${index}`}`}
                    title={group.title}
                    metrics={group.metrics || []}
                />
            ))}
            {children}

            {warning && (
                <div
                    role="status"
                    aria-live="polite"
                    className="flex min-w-0 flex-wrap items-start rounded-lg border border-destructive/40 bg-destructive/10 text-destructive"
                    style={{
                        columnGap: 'var(--receive-summary-inline-gap)',
                        rowGap: 'var(--receive-summary-inline-gap)',
                        padding: 'var(--receive-summary-card-padding)',
                    }}
                >
                    <strong style={{ fontSize: 'var(--receive-summary-value-size)', lineHeight: '1.15' }}>
                        Over-received
                    </strong>
                    <span className="min-w-0 break-words" style={{ fontSize: 'var(--receive-summary-font-size)', lineHeight: '1.35' }}>
                        {warning.message || (
                            <>Over-received by <strong>{formatKg(excessReceivedWeight)} kg</strong>. Review the received weight before closing this issue.</>
                        )}
                    </span>
                </div>
            )}

            <div
                className="flex min-w-0 flex-wrap items-center justify-between"
                style={{
                    columnGap: 'var(--receive-summary-gap)',
                    rowGap: 'var(--receive-summary-inline-gap)',
                }}
            >
                <div className="min-w-0 text-muted-foreground" style={{ fontSize: 'var(--receive-summary-detail-size)', lineHeight: '1.35' }}>
                    Readability size: <span className="font-semibold text-foreground" aria-live="polite">{summaryScalePercent}%</span>
                </div>
                <div className="ml-auto flex items-center gap-1" role="group" aria-label="Summary size controls">
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 min-w-8 px-2"
                        aria-label="Decrease summary size"
                        title="Decrease summary size"
                        onClick={() => adjustSummaryScale(-0.05)}
                    >
                        −
                    </Button>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2"
                        aria-label="Reset summary size"
                        title="Reset summary size"
                        onClick={() => updateSummaryScale(RECEIVE_SUMMARY_SCALE_DEFAULT)}
                    >
                        Reset
                    </Button>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 min-w-8 px-2"
                        aria-label="Increase summary size"
                        title="Increase summary size"
                        onClick={() => adjustSummaryScale(0.05)}
                    >
                        +
                    </Button>
                    <button
                        type="button"
                        role="slider"
                        aria-label="Drag to resize summary"
                        aria-orientation="horizontal"
                        aria-valuemin={RECEIVE_SUMMARY_SCALE_MIN * 100}
                        aria-valuemax={RECEIVE_SUMMARY_SCALE_MAX * 100}
                        aria-valuenow={summaryScalePercent}
                        aria-valuetext={`${summaryScalePercent}% summary size`}
                        title="Drag to resize summary"
                        className="ml-1 flex h-8 w-8 touch-none select-none items-center justify-center rounded-md border border-border/70 bg-background/60 text-base text-muted-foreground hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onKeyDown={handleSummaryResizeKeyDown}
                        onPointerDown={handleSummaryResizePointerDown}
                        onPointerMove={handleSummaryResizePointerMove}
                        onPointerUp={finishSummaryResize}
                        onPointerCancel={finishSummaryResize}
                        onLostPointerCapture={finishSummaryResize}
                    >
                        <span aria-hidden="true">↘</span>
                    </button>
                </div>
            </div>
        </div>
    );
}
