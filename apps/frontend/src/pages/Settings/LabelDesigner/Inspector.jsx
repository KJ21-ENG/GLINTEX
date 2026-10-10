import React, { useRef } from 'react';
import { AlignLeft, AlignCenter, AlignRight, ArrowUpToLine, AlignVerticalJustifyCenter, ArrowDownToLine, Bold, Italic, Underline, Lock, Unlock, Eye, EyeOff, Copy, Trash2, Upload, RotateCw } from 'lucide-react';
import { Field, NumberField, SelectField, Segmented, Toggle, Section, inputClass } from './fields';
import VariableMenu from './VariableMenu';
import { FONT_FAMILIES, QR_EC_LEVELS, LIMITS } from '../../../utils/label/model';
import { Button } from '../../../components/ui';

const TYPE_LABELS = { text: 'Text', barcode: 'Barcode', qr: 'QR code', line: 'Line', rect: 'Box', image: 'Image' };

const readImage = (file) => new Promise((resolve, reject) => {
  if (!file) return reject(new Error('No file selected'));
  if (!['image/png', 'image/jpeg', 'image/svg+xml'].includes(file.type)) return reject(new Error('Use a PNG, JPEG or SVG image'));
  if (file.size > LIMITS.imageBytesMax) return reject(new Error(`Image must be under ${Math.round(LIMITS.imageBytesMax / 1024)} KB`));
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(new Error('Could not read the image'));
  reader.readAsDataURL(file);
});

export default function Inspector({ template, selectedIds, variables, warnings, dispatch, canEdit }) {
  const selected = template.elements.filter((el) => selectedIds.includes(el.id));
  const textAreaRef = useRef(null);
  const valueRef = useRef(null);
  if (selected.length === 0) {
    return (
      <div className="p-4 text-sm text-muted-foreground space-y-2">
        <p className="font-medium text-foreground">Nothing selected</p>
        <p>Click an element on the label to edit it. Shift-click selects several; drag on empty space to box-select.</p>
        <p>Arrow keys nudge by 0.25 mm (Shift: 1 mm). Delete removes. Ctrl/Cmd+D duplicates. Hold Alt while dragging to skip snapping.</p>
      </div>
    );
  }
  const el = selected[0];
  const multi = selected.length > 1;
  const ids = selected.map((s) => s.id);
  const update = (patch) => dispatch({ type: 'updateElements', ids, patch });
  const updateOne = (patch) => dispatch({ type: 'updateElements', ids: [el.id], patch });
  const locked = selected.every((s) => s.locked);
  const disabled = !canEdit;
  const elementWarnings = warnings.filter((w) => ids.includes(w.id));
  const insertAt = (ref, current, snippet, key) => {
    const node = ref.current;
    const start = node?.selectionStart ?? current.length;
    const end = node?.selectionEnd ?? current.length;
    const next = `${current.slice(0, start)}${snippet}${current.slice(end)}`;
    updateOne({ [key]: next });
    requestAnimationFrame(() => { if (node) { node.focus(); node.setSelectionRange(start + snippet.length, start + snippet.length); } });
  };
  const sameType = selected.every((s) => s.type === el.type);

  return (
    <div className="flex flex-col min-h-0">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border/70">
        <div className="min-w-0">
          <div className="text-sm font-semibold truncate">{multi ? `${selected.length} elements` : TYPE_LABELS[el.type]}</div>
          {!multi ? <input className="mt-0.5 w-full bg-transparent text-xs text-muted-foreground focus:outline-none focus:text-foreground" placeholder="Name this element" value={el.name} disabled={disabled} onChange={(e) => updateOne({ name: e.target.value })} /> : null}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button size="icon" variant="ghost" className="h-8 w-8" title={locked ? 'Unlock' : 'Lock position'} disabled={disabled} onClick={() => update({ locked: !locked })}>{locked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}</Button>
          <Button size="icon" variant="ghost" className="h-8 w-8" title={selected.every((s) => s.hidden) ? 'Show' : 'Hide'} disabled={disabled} onClick={() => update({ hidden: !selected.every((s) => s.hidden) })}>{selected.every((s) => s.hidden) ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</Button>
          <Button size="icon" variant="ghost" className="h-8 w-8" title="Duplicate (Ctrl/Cmd+D)" disabled={disabled} onClick={() => dispatch({ type: 'duplicateElements', ids })}><Copy className="h-4 w-4" /></Button>
          <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" title="Remove" disabled={disabled || locked} onClick={() => dispatch({ type: 'removeElements', ids })}><Trash2 className="h-4 w-4" /></Button>
        </div>
      </div>
      {elementWarnings.length ? (
        <div className="mx-3 mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 space-y-1">
          {elementWarnings.map((w, i) => <div key={i}>{w.message}</div>)}
        </div>
      ) : null}
      <div className="overflow-auto">
        <Section title="Position">
          <div className="grid grid-cols-2 gap-2">
            <Field label="X"><NumberField value={el.x} suffix="mm" step={0.5} min={-500} max={500} disabled={disabled || locked} onChange={(v) => update(multi ? (s) => ({ x: s.x + (v - el.x) }) : { x: v })} /></Field>
            <Field label="Y"><NumberField value={el.y} suffix="mm" step={0.5} min={-500} max={500} disabled={disabled || locked} onChange={(v) => update(multi ? (s) => ({ y: s.y + (v - el.y) }) : { y: v })} /></Field>
            {(el.type === 'text' || el.type === 'rect' || el.type === 'image') && !multi ? (<>
              <Field label="Width"><NumberField value={el.w} suffix="mm" step={0.5} min={0.5} max={500} disabled={disabled} onChange={(v) => updateOne({ w: v })} /></Field>
              <Field label="Height"><NumberField value={el.h} suffix="mm" step={0.5} min={0.5} max={500} disabled={disabled} onChange={(v) => updateOne({ h: v })} /></Field>
            </>) : null}
            <Field label="Rotation" className="col-span-2">
              <Segmented value={el.rotation} disabled={disabled} onChange={(v) => update({ rotation: Number(v) })} options={[0, 90, 180, 270].map((r) => ({ value: r, label: `${r}°`, icon: r === 0 ? undefined : RotateCw }))} />
            </Field>
          </div>
        </Section>

        {el.type === 'text' && sameType ? (<>
          <Section title="Text" actions={!multi ? <VariableMenu variables={variables} onInsert={(snippet) => insertAt(textAreaRef, el.text, snippet, 'text')} /> : null}>
            {!multi ? (
              <textarea ref={textAreaRef} className={`${inputClass} h-20 py-1.5 resize-y font-mono text-xs`} value={el.text} disabled={disabled} onChange={(e) => updateOne({ text: e.target.value })} placeholder="Type text, insert @variables" spellCheck={false} />
            ) : <p className="text-xs text-muted-foreground">Editing style for {selected.length} text boxes.</p>}
            <div className="grid grid-cols-[1fr_88px] gap-2">
              <Field label="Font"><SelectField value={el.fontFamily} disabled={disabled} onChange={(v) => update({ fontFamily: v })} options={FONT_FAMILIES.map((f) => ({ value: f.value, label: f.label }))} /></Field>
              <Field label="Size"><NumberField value={el.fontSizePt} suffix="pt" step={0.5} min={LIMITS.fontMinPt} max={LIMITS.fontMaxPt} disabled={disabled} onChange={(v) => update({ fontSizePt: v })} /></Field>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Segmented value={null} disabled={disabled} onChange={() => {}} options={[]} className="hidden" />
              <div className="inline-flex h-8 rounded-md border border-input bg-background p-0.5">
                {[['bold', Bold, 'Bold'], ['italic', Italic, 'Italic'], ['underline', Underline, 'Underline']].map(([key, Icon, title]) => (
                  <button key={key} type="button" title={title} aria-pressed={!!el[key]} disabled={disabled} onClick={() => update({ [key]: !el[key] })} className={`px-2 rounded ${el[key] ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}`}><Icon className="h-3.5 w-3.5" /></button>
                ))}
              </div>
              <Segmented value={el.align} disabled={disabled} onChange={(v) => update({ align: v })} options={[{ value: 'left', icon: AlignLeft, title: 'Align left' }, { value: 'center', icon: AlignCenter, title: 'Centre' }, { value: 'right', icon: AlignRight, title: 'Align right' }]} />
              <Segmented value={el.valign} disabled={disabled} onChange={(v) => update({ valign: v })} options={[{ value: 'top', icon: ArrowUpToLine, title: 'Top' }, { value: 'middle', icon: AlignVerticalJustifyCenter, title: 'Middle' }, { value: 'bottom', icon: ArrowDownToLine, title: 'Bottom' }]} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="When text is too long" className="col-span-2">
                <SelectField value={el.overflow} disabled={disabled} onChange={(v) => update({ overflow: v })} options={[
                  { value: 'wrap-shrink', label: 'Wrap, then shrink the font' },
                  { value: 'shrink', label: 'Shrink the font (one line)' },
                  { value: 'wrap', label: 'Wrap only' },
                  { value: 'clip', label: 'Wrap and clip at the box' },
                ]} />
              </Field>
              {el.overflow === 'shrink' || el.overflow === 'wrap-shrink' ? <Field label="Smallest size"><NumberField value={el.minFontSizePt} suffix="pt" step={0.5} min={LIMITS.fontMinPt} max={el.fontSizePt} disabled={disabled} onChange={(v) => update({ minFontSizePt: v })} /></Field> : null}
              <Field label="Line height"><NumberField value={el.lineHeight} suffix="×" step={0.05} min={0.8} max={3} disabled={disabled} onChange={(v) => update({ lineHeight: v })} /></Field>
              <Field label="Padding"><NumberField value={el.paddingMm} suffix="mm" step={0.1} min={0} max={20} disabled={disabled} onChange={(v) => update({ paddingMm: v })} /></Field>
              <Field label="Letter spacing"><NumberField value={el.letterSpacingPt} suffix="pt" step={0.1} min={-2} max={10} disabled={disabled} onChange={(v) => update({ letterSpacingPt: v })} /></Field>
            </div>
            <div className="flex flex-wrap gap-4">
              <Toggle checked={el.invert} disabled={disabled} onChange={(v) => update({ invert: v })} label="White on black" />
              <Toggle checked={el.uppercase} disabled={disabled} onChange={(v) => update({ uppercase: v })} label="Uppercase" />
            </div>
          </Section>
        </>) : null}

        {el.type === 'barcode' && !multi ? (
          <Section title="Barcode" actions={<VariableMenu variables={variables} onInsert={(snippet) => insertAt(valueRef, el.value, snippet, 'value')} />}>
            <Field label="Value" hint="Code 128. Leave {{barcode}} to print the stage barcode."><input ref={valueRef} className={`${inputClass} font-mono text-xs`} value={el.value} disabled={disabled} onChange={(e) => updateOne({ value: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Bar height"><NumberField value={el.barHeightMm} suffix="mm" step={0.5} min={2} max={100} disabled={disabled} onChange={(v) => updateOne({ barHeightMm: v })} /></Field>
              <Field label="Module width" hint="Snapped to printer dots"><NumberField value={el.moduleMm} suffix="mm" step={0.125} min={LIMITS.moduleMinMm} max={LIMITS.moduleMaxMm} disabled={disabled} onChange={(v) => updateOne({ moduleMm: v })} /></Field>
              <Field label="Max width" hint="0 = no limit; long values narrow the module"><NumberField value={el.maxWidthMm} suffix="mm" step={1} min={0} max={500} disabled={disabled} onChange={(v) => updateOne({ maxWidthMm: v })} /></Field>
              <Field label="Quiet zone"><NumberField value={el.quietZoneMm} suffix="mm" step={0.5} min={0} max={20} disabled={disabled} onChange={(v) => updateOne({ quietZoneMm: v })} /></Field>
              <Field label="Text size"><NumberField value={el.textSizePt} suffix="pt" step={0.5} min={LIMITS.fontMinPt} max={40} disabled={disabled || !el.showText} onChange={(v) => updateOne({ textSizePt: v })} /></Field>
            </div>
            <Toggle checked={el.showText} disabled={disabled} onChange={(v) => updateOne({ showText: v })} label="Print the value under the bars" />
          </Section>
        ) : null}

        {el.type === 'qr' && !multi ? (
          <Section title="QR code" actions={<VariableMenu variables={variables} onInsert={(snippet) => insertAt(valueRef, el.value, snippet, 'value')} />}>
            <Field label="Value"><input ref={valueRef} className={`${inputClass} font-mono text-xs`} value={el.value} disabled={disabled} onChange={(e) => updateOne({ value: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Size"><NumberField value={el.sizeMm} suffix="mm" step={0.5} min={4} max={200} disabled={disabled} onChange={(v) => updateOne({ sizeMm: v })} /></Field>
              <Field label="Error correction"><SelectField value={el.ecLevel} disabled={disabled} onChange={(v) => updateOne({ ecLevel: v })} options={QR_EC_LEVELS.map((l) => ({ value: l, label: { L: 'L · 7%', M: 'M · 15%', Q: 'Q · 25%', H: 'H · 30%' }[l] }))} /></Field>
            </div>
            <p className="text-[11px] text-muted-foreground">Keep about 2 mm clear around the code for reliable scanning.</p>
          </Section>
        ) : null}

        {el.type === 'line' && !multi ? (
          <Section title="Line">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Direction" className="col-span-2"><Segmented value={el.direction} disabled={disabled} onChange={(v) => updateOne({ direction: v })} options={[{ value: 'horizontal', label: 'Horizontal' }, { value: 'vertical', label: 'Vertical' }]} /></Field>
              <Field label="Length"><NumberField value={el.lengthMm} suffix="mm" step={0.5} min={0.5} max={500} disabled={disabled} onChange={(v) => updateOne({ lengthMm: v })} /></Field>
              <Field label="Thickness"><NumberField value={el.thicknessMm} suffix="mm" step={0.1} min={0.1} max={20} disabled={disabled} onChange={(v) => updateOne({ thicknessMm: v })} /></Field>
            </div>
          </Section>
        ) : null}

        {el.type === 'rect' && !multi ? (
          <Section title="Box">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Border"><NumberField value={el.strokeMm} suffix="mm" step={0.1} min={0} max={20} disabled={disabled} onChange={(v) => updateOne({ strokeMm: v })} /></Field>
              <Field label="Corner radius"><NumberField value={el.radiusMm} suffix="mm" step={0.5} min={0} max={50} disabled={disabled} onChange={(v) => updateOne({ radiusMm: v })} /></Field>
            </div>
            <Toggle checked={el.fill} disabled={disabled} onChange={(v) => updateOne({ fill: v })} label="Solid black fill" />
          </Section>
        ) : null}

        {el.type === 'image' && !multi ? (
          <Section title="Image">
            <div className="flex items-center gap-3">
              {el.src ? <img src={el.src} alt="" className="h-14 w-14 object-contain border border-border bg-white rounded" /> : <div className="h-14 w-14 rounded border border-dashed border-border grid place-items-center text-[10px] text-muted-foreground">none</div>}
              <label className={`h-8 inline-flex items-center gap-1 rounded-md border border-input bg-background px-2 text-xs cursor-pointer hover:bg-accent ${disabled ? 'pointer-events-none opacity-50' : ''}`}>
                <Upload className="h-3.5 w-3.5" /> Choose image
                <input type="file" accept="image/png,image/jpeg,image/svg+xml" className="hidden" onChange={async (e) => { try { const src = await readImage(e.target.files?.[0]); updateOne({ src }); } catch (error) { window.alert(error.message); } e.target.value = ''; }} />
              </label>
            </div>
            <Field label="Fit"><Segmented value={el.fit} disabled={disabled} onChange={(v) => updateOne({ fit: v })} options={[{ value: 'contain', label: 'Keep proportions' }, { value: 'stretch', label: 'Stretch' }]} /></Field>
            <p className="text-[11px] text-muted-foreground">Thermal printers print pure black; use a black-and-white logo for a clean result.</p>
          </Section>
        ) : null}
      </div>
    </div>
  );
}
