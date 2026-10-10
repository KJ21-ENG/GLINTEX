import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { artifactPageMarkup } from '../../utils/label/artifact';

// Shows one page of a printable artifact exactly as the printer receives it: the same
// HTML in a shadow root, scaled to the available width. Nothing is re-laid out here.
export default function LabelArtifactPreview({ artifact, pageIndex = 0, maxWidthPx = 480, className = '' }) {
  const hostRef = useRef(null);
  const [scale, setScale] = useState(1);
  const page = artifact?.pages?.[pageIndex];
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host || !page) return;
    const root = host.shadowRoot || host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>:host{display:block}</style>${artifactPageMarkup(artifact, pageIndex)}`;
  }, [artifact, page, pageIndex]);
  useEffect(() => {
    if (!artifact) return;
    const widthPx = (artifact.widthMm / 25.4) * 96;
    setScale(Math.min(1, maxWidthPx / widthPx));
  }, [artifact, maxWidthPx]);
  if (!page) return null;
  const widthPx = (artifact.widthMm / 25.4) * 96;
  const heightPx = (artifact.heightMm / 25.4) * 96;
  return (
    <div className={className} style={{ width: widthPx * scale, height: heightPx * scale, overflow: 'hidden', background: '#fff', boxShadow: '0 0 0 1px rgba(15,23,42,0.12)' }}>
      <div ref={hostRef} style={{ width: widthPx, height: heightPx, transform: `scale(${scale})`, transformOrigin: 'top left' }} />
    </div>
  );
}
