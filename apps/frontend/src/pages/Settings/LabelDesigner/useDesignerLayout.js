import { useEffect, useMemo, useRef, useState } from 'react';
import { layoutLabel } from '../../../utils/label/layout';
import { renderLabelMarkup, BASE_CSS } from '../../../utils/label/html';
import { fontFamilyCss } from '../../../utils/label/model';
import { createCanvasMeasurer } from '../../../utils/label/measure';
import { ensureFontsReady } from '../../../utils/label/fonts';

let sharedMeasurer = null;
const getMeasurer = () => {
  if (!sharedMeasurer) sharedMeasurer = createCanvasMeasurer();
  return sharedMeasurer;
};

// Lays the label out with the real fonts and returns the exact markup the printer gets
// for this template and sample data, plus per-element geometry for the editor overlays.
export function useDesignerLayout(template, data, dpi = 203) {
  const [fontsReady, setFontsReady] = useState(false);
  const fontKey = useMemo(() => template.elements.map((el) => el.fontFamily || '').join('|'), [template.elements]);
  const measurerRef = useRef(null);
  useEffect(() => {
    let live = true;
    setFontsReady(false);
    ensureFontsReady(template).then(() => {
      if (!live) return;
      measurerRef.current?.clear?.();
      setFontsReady(true);
    }).catch(() => { if (live) setFontsReady(true); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fontKey]);
  return useMemo(() => {
    if (!measurerRef.current) measurerRef.current = getMeasurer();
    const layout = layoutLabel(template, data, measurerRef.current, { dpi });
    const markup = renderLabelMarkup(layout, fontFamilyCss);
    const warnings = [];
    for (const el of layout.elements) {
      if (el.layout?.error) warnings.push({ id: el.id, level: 'error', message: el.layout.error });
      else if (el.layout?.overflowing) warnings.push({ id: el.id, level: 'warning', message: el.type === 'barcode' ? 'Wider than its limit even at two dots per module' : 'Text does not fit its box' });
      const box = el.box;
      if (box.x < -0.001 || box.y < -0.001 || box.x + (el.rotation % 180 ? box.h : box.w) > layout.canvas.widthMm + 0.001 || box.y + (el.rotation % 180 ? box.w : box.h) > layout.canvas.heightMm + 0.001) {
        warnings.push({ id: el.id, level: 'warning', message: 'Outside the label; the printer clips it' });
      }
    }
    return { layout, markup, css: BASE_CSS, warnings, fontsReady };
  }, [template, data, dpi, fontsReady]);
}
