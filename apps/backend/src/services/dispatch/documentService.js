import { createHash } from 'node:crypto';
import prisma from '../../lib/prisma.js';
import { lockRecord } from '../packing/common.js';
import { notFound } from '../packing/errors.js';
import { serialize } from '../packing/serialization.js';
import { requiredId } from './common.js';
import { getDispatchChallan } from './dispatchService.js';
import { generateDispatchChallanPdf } from '../../utils/pdf/dispatchChallanPdf.js';

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function filenamePart(value) {
  return String(value || 'dispatch-challan').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 100) || 'dispatch-challan';
}

export async function getDispatchDocument({ id, client = prisma } = {}) {
  const challanId = requiredId(id, 'challanId');
  if (challanId.startsWith('legacy:')) {
    const challan = await getDispatchChallan({ id: challanId, client });
    const pdfBytes = await generateDispatchChallanPdf(challan);
    return {
      pdfBytes,
      sha256Hash: sha256(pdfBytes),
      kind: 'LEGACY_RECONSTRUCTION',
      filename: `${filenamePart(challan.challanNo)}.pdf`,
      challan,
    };
  }
  const result = await client.$transaction(async (tx) => {
    await lockRecord(tx, 'DispatchChallan', challanId, 'dispatch_challan_not_found', 'Dispatch challan not found.');
    const challan = await tx.dispatchChallan.findUnique({
      where: { id: challanId },
      include: {
        customer: true,
        lines: {
          orderBy: { createdAt: 'asc' },
          include: { parentPackedUnit: { select: { id: true, barcode: true, levelIndex: true, status: true } } },
        },
      },
    });
    if (!challan) throw notFound('dispatch_challan_not_found', 'Dispatch challan not found.', { id: challanId });
    const existing = await tx.dispatchDocument.findUnique({ where: { challanId } });
    if (existing?.pdfBytes) {
      return {
        pdfBytes: Buffer.from(existing.pdfBytes),
        sha256Hash: existing.sha256Hash,
        kind: existing.kind,
        filename: `${filenamePart(challan.challanNo)}.pdf`,
        challan,
      };
    }
    const snapshot = existing?.kind === 'LEGACY_RECONSTRUCTION' && existing.renderingSnapshot
      ? serialize(existing.renderingSnapshot)
      : serialize({
        ...challan,
        document: undefined,
        lines: challan.lines.map((line) => ({
          ...line,
          sourceDisplaySnapshot: line.sourceDisplaySnapshot || {},
        })),
      });
    const pdfBytes = await generateDispatchChallanPdf(snapshot);
    const hash = sha256(pdfBytes);
    const document = existing
      ? await tx.dispatchDocument.update({ where: { challanId }, data: { renderingSnapshot: snapshot, pdfBytes, sha256Hash: hash, generatedAt: new Date(), kind: challan.isLegacyReconstruction ? 'LEGACY_RECONSTRUCTION' : 'ORIGINAL' } })
      : await tx.dispatchDocument.create({ data: { challanId, kind: challan.isLegacyReconstruction ? 'LEGACY_RECONSTRUCTION' : 'ORIGINAL', renderingSnapshot: snapshot, pdfBytes, sha256Hash: hash, generatedAt: new Date() } });
    return { pdfBytes, sha256Hash: document.sha256Hash, kind: document.kind, filename: `${filenamePart(challan.challanNo)}.pdf`, challan };
  });
  return result;
}
