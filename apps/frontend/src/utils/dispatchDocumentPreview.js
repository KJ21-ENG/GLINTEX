import { formatDateDDMMYYYY, formatKg } from './formatting.js';

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function getSnapshot(document) {
  return document?.renderingSnapshot || document?.snapshot || document?.documentSnapshot || document || {};
}

function getLines(document, snapshot) {
  return document?.lines || snapshot?.lines || snapshot?.items || document?.items || [];
}

function normalizeLine(line = {}) {
  const source = line.sourceDisplaySnapshot || line.source || {};
  return {
    itemName: firstDefined(line.itemName, source.itemName, source.name, '—'),
    barcode: firstDefined(line.barcode, line.sourceBarcode, source.barcode, '—'),
    packageKind: firstDefined(line.packageKind, line.packageTypeName, source.packageKind, source.packageTypeName, '—'),
    baseCount: firstDefined(line.baseCount, line.count, source.baseCount),
    netWeightKg: firstDefined(line.netWeightKg, line.weight, source.netWeightKg, source.weight),
    sourceType: firstDefined(line.sourceType, source.sourceType, '—'),
    children: Array.isArray(line.children) ? line.children : [],
  };
}

function renderLineRows(lines) {
  return lines.map((rawLine, index) => {
    const line = normalizeLine(rawLine);
    const childRows = line.children.map((child, childIndex) => {
      const normalizedChild = normalizeLine(child);
      return `
        <tr class="child-row">
          <td>${escapeHtml(`${index + 1}.${childIndex + 1}`)}</td>
          <td>${escapeHtml(normalizedChild.itemName)}</td>
          <td class="mono">${escapeHtml(normalizedChild.barcode)}</td>
          <td>${escapeHtml(normalizedChild.packageKind)}</td>
          <td class="numeric">${escapeHtml(normalizedChild.baseCount ?? '—')}</td>
          <td class="numeric">${escapeHtml(normalizedChild.netWeightKg == null ? '—' : formatKg(normalizedChild.netWeightKg))}</td>
        </tr>`;
    }).join('');

    return `
      <tr>
        <td>${escapeHtml(index + 1)}</td>
        <td>${escapeHtml(line.itemName)}</td>
        <td class="mono">${escapeHtml(line.barcode)}</td>
        <td>${escapeHtml(line.packageKind)}</td>
        <td class="numeric">${escapeHtml(line.baseCount ?? '—')}</td>
        <td class="numeric">${escapeHtml(line.netWeightKg == null ? '—' : formatKg(line.netWeightKg))}</td>
      </tr>${childRows}`;
  }).join('');
}

export function buildDispatchDocumentHtml(documents = [], { title = 'Dispatch challan' } = {}) {
  const normalizedDocuments = Array.isArray(documents) ? documents : [documents];
  const pages = normalizedDocuments.filter(Boolean).map((document) => {
    const snapshot = getSnapshot(document);
    const customer = snapshot.customer || document.customer || {};
    const company = snapshot.company || document.company || {};
    const lines = getLines(document, snapshot).map(normalizeLine);
    const totalCount = lines.reduce((total, line) => total + (Number(line.baseCount) || 0), 0);
    const totalWeight = lines.reduce((total, line) => total + (Number(line.netWeightKg) || 0), 0);
    const challanNo = firstDefined(snapshot.challanNo, document.challanNo, '—');
    const businessDate = firstDefined(snapshot.businessDate, snapshot.date, document.businessDate, document.date, '');
    const notes = firstDefined(snapshot.notes, document.notes, '');

    return `
      <section class="dispatch-document-page">
        <header class="document-header">
          <div>
            <div class="company-name">${escapeHtml(firstDefined(company.name, 'GLINTEX'))}</div>
            ${company.address ? `<div>${escapeHtml(company.address)}</div>` : ''}
            ${company.mobile ? `<div>${escapeHtml(company.mobile)}</div>` : ''}
          </div>
          <div class="document-title">DELIVERY CHALLAN</div>
        </header>

        <div class="meta-grid">
          <div><span class="meta-label">Challan No.</span><strong>${escapeHtml(challanNo)}</strong></div>
          <div><span class="meta-label">Business date</span>${escapeHtml(formatDateDDMMYYYY(businessDate) || '—')}</div>
          <div><span class="meta-label">Customer</span>${escapeHtml(firstDefined(customer.name, snapshot.customerName, '—'))}</div>
          <div><span class="meta-label">Customer phone</span>${escapeHtml(firstDefined(customer.phone, '—'))}</div>
        </div>

        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Item</th>
              <th>Barcode</th>
              <th>Package</th>
              <th class="numeric">Base count</th>
              <th class="numeric">Net kg</th>
            </tr>
          </thead>
          <tbody>${renderLineRows(lines)}</tbody>
          <tfoot>
            <tr>
              <td colspan="4" class="numeric">Totals</td>
              <td class="numeric">${escapeHtml(totalCount || '—')}</td>
              <td class="numeric">${escapeHtml(formatKg(totalWeight))}</td>
            </tr>
          </tfoot>
        </table>

        ${notes ? `<div class="notes"><strong>Notes:</strong> ${escapeHtml(notes)}</div>` : ''}
        <footer class="signature-row">
          <div>Receiver signature</div>
          <div>For ${escapeHtml(firstDefined(company.name, 'GLINTEX'))}</div>
        </footer>
      </section>`;
  }).join('');

  return `<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(title)}</title>
        <style>
          @page { size: A4; margin: 14mm; }
          :root { color-scheme: light; font-family: Arial, sans-serif; color: #111827; }
          * { box-sizing: border-box; }
          body { margin: 0; background: #f3f4f6; }
          .dispatch-document-page { width: 100%; min-height: 260mm; padding: 8mm; margin: 0 auto 12mm; background: #fff; break-after: page; }
          .dispatch-document-page:last-child { break-after: auto; }
          .document-header { display: flex; justify-content: space-between; gap: 24px; padding-bottom: 18px; border-bottom: 2px solid #111827; }
          .company-name { font-size: 22px; font-weight: 700; letter-spacing: .04em; }
          .document-title { align-self: center; font-size: 18px; font-weight: 700; letter-spacing: .08em; }
          .meta-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 24px; padding: 18px 0; }
          .meta-grid > div { display: flex; gap: 8px; min-width: 0; }
          .meta-label { min-width: 105px; color: #6b7280; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; }
          table { width: 100%; border-collapse: collapse; font-size: 12px; }
          th, td { padding: 8px 7px; border: 1px solid #d1d5db; text-align: left; vertical-align: top; }
          th { background: #f3f4f6; font-size: 10px; letter-spacing: .04em; text-transform: uppercase; }
          .numeric { text-align: right; white-space: nowrap; }
          .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
          .child-row td { background: #fafafa; color: #4b5563; }
          .notes { margin-top: 18px; padding: 10px 12px; background: #f9fafb; border-left: 3px solid #9ca3af; font-size: 12px; }
          .signature-row { display: flex; justify-content: space-between; gap: 24px; margin-top: 60px; padding-top: 10px; }
          .signature-row > div { width: 38%; padding-top: 8px; border-top: 1px solid #111827; text-align: center; font-size: 11px; }
          @media screen { .dispatch-document-page { box-shadow: 0 5px 18px rgba(15, 23, 42, .12); max-width: 210mm; } }
          @media print { body { background: #fff; } .dispatch-document-page { margin: 0; box-shadow: none; } }
        </style>
      </head>
      <body>${pages || '<p>No dispatch document available.</p>'}</body>
    </html>`;
}

export function openDispatchDocumentPreview(documents, { title = 'Dispatch challan preview', autoPrint = false } = {}) {
  if (typeof window === 'undefined') return null;
  const previewWindow = window.open('', '_blank');
  if (!previewWindow) throw new Error('The browser blocked the document preview window');
  previewWindow.document.open();
  previewWindow.document.write(buildDispatchDocumentHtml(documents, { title }));
  previewWindow.document.close();
  if (autoPrint) {
    previewWindow.addEventListener('load', () => previewWindow.print(), { once: true });
  }
  return previewWindow;
}

export function printDispatchDocuments(documents, options = {}) {
  return openDispatchDocumentPreview(documents, { ...options, autoPrint: true });
}

export function openDispatchPdfBlob(blob, { autoPrint = false, title = 'Dispatch challan PDF' } = {}) {
  if (typeof window === 'undefined' || !blob) return null;
  const url = window.URL.createObjectURL(blob);
  const previewWindow = window.open(url, '_blank');
  if (!previewWindow) {
    window.URL.revokeObjectURL(url);
    throw new Error('The browser blocked the PDF preview window');
  }
  if (autoPrint) {
    previewWindow.addEventListener('load', () => previewWindow.print(), { once: true });
  }
  previewWindow.document.title = title;
  window.setTimeout(() => window.URL.revokeObjectURL(url), 60_000);
  return previewWindow;
}

export function downloadDispatchPdfBlob(blob, filename = 'dispatch-challan.pdf') {
  if (typeof window === 'undefined' || !blob) return;
  const url = window.URL.createObjectURL(blob);
  const anchor = window.document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  window.document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(url), 0);
}

export { escapeHtml };
