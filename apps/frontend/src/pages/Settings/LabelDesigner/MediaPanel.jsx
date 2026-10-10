import React from 'react';
import { Field, NumberField, SelectField, Segmented, Section } from './fields';
import { usedRollWidthMm, LIMITS } from '../../../utils/label/model';

const PRESETS = [
  { key: '75x125', label: '75 × 125 mm roll · landscape', media: { widthMm: 75, heightMm: 125, orientation: 'landscape', rollWidthMm: 75, columns: 1, columnGapMm: 2, rowGapMm: 2, marginLeftMm: 0, marginTopMm: 0 } },
  { key: '50x25x2', label: '50 × 25 mm · 2 across', media: { widthMm: 50, heightMm: 25, orientation: 'portrait', rollWidthMm: 105, columns: 2, columnGapMm: 2, rowGapMm: 2, marginLeftMm: 1.5, marginTopMm: 0 } },
  { key: '100x50', label: '100 × 50 mm roll', media: { widthMm: 100, heightMm: 50, orientation: 'portrait', rollWidthMm: 100, columns: 1, columnGapMm: 2, rowGapMm: 2, marginLeftMm: 0, marginTopMm: 0 } },
];

export default function MediaPanel({ template, dispatch, canEdit }) {
  const { media } = template;
  const disabled = !canEdit;
  const set = (patch) => dispatch({ type: 'updateMedia', patch });
  const used = usedRollWidthMm(media);
  const overRoll = used > media.rollWidthMm + 0.001;
  return (
    <>
      <Section title="Label & roll" defaultOpen>
        <Field label="Preset">
          <SelectField value="" disabled={disabled} onChange={(key) => { const p = PRESETS.find((x) => x.key === key); if (p) set(p.media); }} options={[{ value: '', label: 'Apply a preset…' }, ...PRESETS.map((p) => ({ value: p.key, label: p.label }))]} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Label width" hint="across the roll"><NumberField value={media.widthMm} suffix="mm" step={0.5} min={LIMITS.mediaMinMm} max={LIMITS.mediaMaxMm} disabled={disabled} onChange={(v) => set({ widthMm: v })} /></Field>
          <Field label="Label length" hint="along the feed"><NumberField value={media.heightMm} suffix="mm" step={0.5} min={LIMITS.mediaMinMm} max={LIMITS.mediaMaxMm} disabled={disabled} onChange={(v) => set({ heightMm: v })} /></Field>
          <Field label="Design orientation" className="col-span-2" hint={media.orientation === 'landscape' ? 'You design the label sideways; it prints rotated onto the roll.' : 'You design the label as it feeds.'}>
            <Segmented value={media.orientation} disabled={disabled} onChange={(v) => set({ orientation: v })} options={[{ value: 'portrait', label: 'Upright' }, { value: 'landscape', label: 'Sideways' }]} />
          </Field>
          <Field label="Roll width"><NumberField value={media.rollWidthMm} suffix="mm" step={0.5} min={LIMITS.mediaMinMm} max={LIMITS.mediaMaxMm} disabled={disabled} onChange={(v) => set({ rollWidthMm: v })} /></Field>
          <Field label="Labels across"><NumberField value={media.columns} step={1} min={1} max={LIMITS.columnsMax} disabled={disabled} onChange={(v) => set({ columns: Math.round(v) })} /></Field>
          <Field label="Gap across"><NumberField value={media.columnGapMm} suffix="mm" step={0.5} min={0} max={100} disabled={disabled} onChange={(v) => set({ columnGapMm: v })} /></Field>
          <Field label="Gap along" hint="driver gap sensor"><NumberField value={media.rowGapMm} suffix="mm" step={0.5} min={0} max={100} disabled={disabled} onChange={(v) => set({ rowGapMm: v })} /></Field>
        </div>
        {overRoll ? <p className="text-xs text-red-600">Labels and gaps need {used} mm but the roll is {media.rollWidthMm} mm wide.</p> : <p className="text-[11px] text-muted-foreground">Uses {used} mm of the {media.rollWidthMm} mm roll.</p>}
        {media.columns > 1 ? (
          <Field label="Several labels across" hint={media.columnMode === 'repeat' ? 'Each column prints the same label.' : 'Consecutive labels fill the columns.'}>
            <Segmented value={media.columnMode} disabled={disabled} onChange={(v) => set({ columnMode: v })} options={[{ value: 'repeat', label: 'Repeat' }, { value: 'sequence', label: 'Sequence' }]} />
          </Field>
        ) : null}
      </Section>
      <Section title="Margins & calibration" defaultOpen={false}>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Left margin"><NumberField value={media.marginLeftMm} suffix="mm" step={0.5} min={0} max={100} disabled={disabled} onChange={(v) => set({ marginLeftMm: v })} /></Field>
          <Field label="Top margin"><NumberField value={media.marginTopMm} suffix="mm" step={0.5} min={0} max={100} disabled={disabled} onChange={(v) => set({ marginTopMm: v })} /></Field>
          <Field label="Nudge X"><NumberField value={media.offsetXMm} suffix="mm" step={0.1} min={-50} max={50} disabled={disabled} onChange={(v) => set({ offsetXMm: v })} /></Field>
          <Field label="Nudge Y"><NumberField value={media.offsetYMm} suffix="mm" step={0.1} min={-50} max={50} disabled={disabled} onChange={(v) => set({ offsetYMm: v })} /></Field>
        </div>
        <p className="text-[11px] text-muted-foreground">Nudges shift the whole artwork on the page to match the printer after a test print.</p>
      </Section>
      <Section title="Copies" defaultOpen={false}>
        <Field label="Copies per transaction"><NumberField value={template.copies} step={1} min={1} max={LIMITS.copiesMax} disabled={disabled} onChange={(v) => dispatch({ type: 'setCopies', copies: Math.round(v) })} /></Field>
      </Section>
    </>
  );
}
