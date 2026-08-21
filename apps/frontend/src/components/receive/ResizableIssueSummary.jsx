import React, { useEffect, useRef, useState } from 'react';
import { Button } from '../ui';
import { formatKg } from '../../utils';

export const RECEIVE_SUMMARY_SCALE_STORAGE_KEY = 'glintex.receiveIssueSummaryScale.v1';
export const LEGACY_CONING_SUMMARY_SCALE_STORAGE_KEY = 'glintex.coningSummaryScale.v1';
export const RECEIVE_SUMMARY_SCALE_DEFAULT = 1;
export const RECEIVE_SUMMARY_SCALE_DECREASE_FACTOR = 1 / 1.1;
export const RECEIVE_SUMMARY_SCALE_INCREASE_FACTOR = 1.1;
export const RECEIVE_SUMMARY_SCALE_POINTER_PIXELS = 250;
export const RECEIVE_SUMMARY_OVER_ISSUED_EPSILON_KG = 0.001;

function normalizeReceiveSummaryScale(value, fallbackValue = RECEIVE_SUMMARY_SCALE_DEFAULT) {
    const numericValue = Number(value);
    const numericFallback = Number(fallbackValue);
    const safeFallback = Number.isFinite(numericFallback) && numericFallback > 0
        ? numericFallback
        : RECEIVE_SUMMARY_SCALE_DEFAULT;
    if (!Number.isFinite(numericValue) || numericValue <= 0) return safeFallback;
    return numericValue;
}

function readReceiveSummaryScale() {
    if (typeof window === 'undefined') return RECEIVE_SUMMARY_SCALE_DEFAULT;
    try {
        const storedValue = window.localStorage.getItem(RECEIVE_SUMMARY_SCALE_STORAGE_KEY);
        if (storedValue != null && storedValue.trim() !== '') {
            return normalizeReceiveSummaryScale(storedValue);
        }

        const legacyValue = window.localStorage.getItem(LEGACY_CONING_SUMMARY_SCALE_STORAGE_KEY);
        if (legacyValue == null || legacyValue.trim() === '') return RECEIVE_SUMMARY_SCALE_DEFAULT;
        return normalizeReceiveSummaryScale(legacyValue);
    } catch {
        return RECEIVE_SUMMARY_SCALE_DEFAULT;
    }
}

function multiplyReceiveSummaryScale(value, multiplier) {
    const currentScale = normalizeReceiveSummaryScale(value);
    const safeMultiplier = normalizeReceiveSummaryScale(multiplier, 1);
    return normalizeReceiveSummaryScale(currentScale * safeMultiplier, currentScale);
}

function getPointerSummaryScale(startScale, diagonalDelta) {
    const currentScale = normalizeReceiveSummaryScale(startScale);
    const numericDelta = Number(diagonalDelta);
    if (!Number.isFinite(numericDelta)) return currentScale;

    const nextScale = currentScale * Math.exp(numericDelta / RECEIVE_SUMMARY_SCALE_POINTER_PIXELS);
    return normalizeReceiveSummaryScale(nextScale, currentScale);
}

function formatReceiveSummaryScalePercent(scale) {
    const percent = scale * 100;
    if (!Number.isFinite(percent)) return `${scale.toExponential(2)} × 100%`;
    if (percent >= 1) return `${Math.round(percent)}%`;
    return `${percent.toPrecision(2)}%`;
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
            const nextScale = normalizeReceiveSummaryScale(resolvedValue, previousValue);
            summaryScaleRef.current = nextScale;
            return nextScale;
        });
    };

    const adjustSummaryScale = (multiplier) => {
        updateSummaryScale((currentScale) => multiplyReceiveSummaryScale(currentScale, multiplier));
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
        updateSummaryScale(getPointerSummaryScale(activeResize.startScale, diagonalDelta));
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
                adjustSummaryScale(RECEIVE_SUMMARY_SCALE_DECREASE_FACTOR);
                break;
            case 'ArrowRight':
            case 'ArrowUp':
                event.preventDefault();
                adjustSummaryScale(RECEIVE_SUMMARY_SCALE_INCREASE_FACTOR);
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

    const summaryScalePercent = formatReceiveSummaryScalePercent(summaryScale);
    const summaryStyle = {
        '--receive-summary-font-size': `${summaryScale}rem`,
        '--receive-summary-line-height': `${1.5 * summaryScale}rem`,
        '--receive-summary-gap': `${0.9 * summaryScale}rem`,
        '--receive-summary-group-gap': `${0.55 * summaryScale}rem`,
        '--receive-summary-inline-gap': `${0.4 * summaryScale}rem`,
        '--receive-summary-padding': `${summaryScale}rem`,
        '--receive-summary-card-padding': `${0.8 * summaryScale}rem`,
        '--receive-summary-card-value-offset': `${0.3 * summaryScale}rem`,
        '--receive-summary-detail-offset': `${0.35 * summaryScale}rem`,
        '--receive-summary-card-min': `${10 * summaryScale}rem`,
        '--receive-summary-heading-size': `${summaryScale}rem`,
        '--receive-summary-label-size': `${summaryScale}rem`,
        '--receive-summary-value-size': `${1.35 * summaryScale}rem`,
        '--receive-summary-unit-size': `${0.95 * summaryScale}rem`,
        '--receive-summary-detail-size': `${0.9 * summaryScale}rem`,
    };
    const summaryId = idPrefix || 'receive-summary';
    const summaryScaleValueId = `${summaryId}-scale-value`;
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
                    Readability size: <span id={summaryScaleValueId} className="font-semibold text-foreground" aria-live="polite">{summaryScalePercent}</span>
                </div>
                <div className="ml-auto flex items-center gap-1" role="group" aria-label="Summary size controls">
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 min-w-8 px-2"
                        aria-label="Decrease summary size"
                        title="Decrease summary size"
                        onClick={() => adjustSummaryScale(RECEIVE_SUMMARY_SCALE_DECREASE_FACTOR)}
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
                        onClick={() => adjustSummaryScale(RECEIVE_SUMMARY_SCALE_INCREASE_FACTOR)}
                    >
                        +
                    </Button>
                    <button
                        type="button"
                        aria-label={`Resize summary, currently ${summaryScalePercent}`}
                        aria-describedby={summaryScaleValueId}
                        aria-keyshortcuts="ArrowDown ArrowUp ArrowLeft ArrowRight R"
                        title="Drag to resize summary. Use arrow keys to adjust or R to reset."
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
