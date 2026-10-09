import { transactionWeightProvenance } from './weightProvenance.js';

export function buildCutterReceiveEntries(cart) {
  return cart.map(entry => ({
    issueId: entry.issueId,
    pieceId: entry.pieceId,
    lotNo: entry.lotNo,
    bobbinId: entry.bobbinId,
    boxId: entry.boxId,
    bobbinQuantity: Number(entry.bobbinQty),
    grossWeight: Number(entry.grossWeight),
    // Wastage closes the server-calculated balance; it has no measured gross weight.
    weightProvenance: entry.isWastage ? undefined : transactionWeightProvenance(entry.grossWeight, entry.weightProvenance),
    receiveDate: entry.receiveDate,
    operatorId: entry.operatorId,
    cutId: entry.cutId,
    helperId: entry.helperId,
    shift: entry.shift,
    isWastage: entry.isWastage,
    wastageNote: entry.isWastage ? (entry.wastageNote || null) : undefined,
  }));
}
