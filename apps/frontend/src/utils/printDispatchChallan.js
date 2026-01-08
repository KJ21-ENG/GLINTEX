
import { formatDateDDMMYYYY } from './formatting';

export const printDispatchChallan = (dispatch, firmDetails = {}) => {
    if (!dispatch) return;

    // Company Details (Default to Glintex if not provided)
    const companyName = firmDetails.name || 'GLINTEX';
    const companyAddress = firmDetails.address || '';
    const companyPhone = firmDetails.mobile || '';

    // Challan Details
    const challanNo = dispatch.challanNo;
    const date = formatDateDDMMYYYY(dispatch.date);

    // Customer Details
    const customerName = dispatch.customer?.name || 'N/A';
    const customerAddress = dispatch.customer?.address || '';
    const customerPhone = dispatch.customer?.phone || '';

    const items = Array.isArray(dispatch.items) && dispatch.items.length > 0
        ? dispatch.items
        : [dispatch];
    const stage = (dispatch.stage || items[0]?.stage || '').toUpperCase();
    const notes = dispatch.notes || '';

    const rows = items.map((item, idx) => {
        const itemWeight = typeof item.weight === 'number' ? item.weight.toFixed(3) : item.weight;
        const itemCount = item.count ? ` (${item.count})` : '';
        return `
          <tr>
            <td>${idx + 1}</td>
            <td>${stage} Material${itemCount}${notes ? `<div style="font-size: 11px; color: #666; margin-top: 4px;">Note: ${notes}</div>` : ''}</td>
            <td style="font-family: monospace;">${item.stageBarcode || item.barcode || ''}</td>
            <td class="text-right">${itemWeight || ''}</td>
          </tr>
        `;
    }).join('');

    const totalWeightValue = items.reduce((sum, item) => sum + (Number(item.weight) || 0), 0);
    const totalWeight = totalWeightValue.toFixed(3);

    const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Delivery Challan - ${challanNo}</title>
      <style>
        @page { margin: 0; size: auto; }
        body { 
          font-family: 'Inter', sans-serif; 
          font-size: 14px; 
          line-height: 1.5; 
          color: #000; 
          margin: 20mm;
          padding: 0;
        }
        
        .header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #ccc; padding-bottom: 20px; }
        .company-name { font-size: 24px; font-weight: bold; margin-bottom: 5px; }
        .company-details { font-size: 12px; color: #555; }
        
        .title { text-align: center; font-size: 18px; font-weight: bold; margin-bottom: 30px; text-decoration: underline; }
        
        .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-bottom: 30px; }
        .info-box h3 { font-size: 14px; font-weight: bold; margin: 0 0 5px 0; text-transform: uppercase; color: #333; border-bottom: 1px solid #eee; padding-bottom: 5px; margin-bottom: 10px; }
        .info-row { display: flex; margin-bottom: 5px; }
        .info-label { width: 100px; font-weight: bold; color: #555; }
        .info-val { flex: 1; }

        table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
        th, td { border: 1px solid #ccc; padding: 10px; text-align: left; }
        th { background-color: #f9f9f9; font-weight: bold; text-transform: uppercase; font-size: 12px; }
        .text-right { text-align: right; }
        
        .footer { display: flex; justify-content: space-between; margin-top: 60px; padding-top: 20px; }
        .signature-box { text-align: center; width: 200px; border-top: 1px solid #000; padding-top: 10px; font-size: 12px; font-weight: bold; }
        
        @media print {
          body { -webkit-print-color-adjust: exact; }
          .no-print { display: none; }
        }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="company-name">${companyName}</div>
        <div class="company-details">
          ${companyAddress ? `<div>${companyAddress}</div>` : ''}
          ${companyPhone ? `<div>Tel: ${companyPhone}</div>` : ''}
        </div>
      </div>

      <div class="title">DELIVERY CHALLAN</div>

      <div class="info-grid">
        <div class="info-box">
          <h3>Challan Details</h3>
          <div class="info-row">
            <span class="info-label">Challan No:</span>
            <span class="info-val" style="font-weight: bold;">${challanNo}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Date:</span>
            <span class="info-val">${date}</span>
          </div>
        </div>
        
        <div class="info-box">
          <h3>Customer Details</h3>
          <div class="info-row">
            <span class="info-label">Name:</span>
            <span class="info-val" style="font-weight: bold;">${customerName}</span>
          </div>
          ${customerAddress ? `
          <div class="info-row">
            <span class="info-label">Address:</span>
            <span class="info-val">${customerAddress}</span>
          </div>` : ''}
          ${customerPhone ? `
          <div class="info-row">
            <span class="info-label">Phone:</span>
            <span class="info-val">${customerPhone}</span>
          </div>` : ''}
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th style="width: 50px;">#</th>
            <th>Description</th>
            <th>Barcode</th>
            <th class="text-right">Weight (kg)</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="3" class="text-right" style="font-weight: bold;">Total Weight</td>
            <td class="text-right" style="font-weight: bold;">${totalWeight}</td>
          </tr>
        </tfoot>
      </table>

      <div class="footer">
        <div class="signature-box">
          Receiver's Signature
        </div>
        <div class="signature-box">
          Authorized Signatory<br>
          For ${companyName}
        </div>
      </div>
    </body>
    </html>
  `;

    // Use a hidden iframe to print without opening a new tab
    let iframe = document.getElementById('print-iframe');
    if (!iframe) {
        iframe = document.createElement('iframe');
        iframe.id = 'print-iframe';
        iframe.style.position = 'fixed';
        iframe.style.right = '0';
        iframe.style.bottom = '0';
        iframe.style.width = '0';
        iframe.style.height = '0';
        iframe.style.border = 'none';
        document.body.appendChild(iframe);
    }

    const doc = iframe.contentWindow.document;
    doc.open();
    doc.write(html);
    doc.close();

    // Wait for content (like images/logos) to load if any
    setTimeout(() => {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
    }, 500);
};
