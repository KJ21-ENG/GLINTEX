import { Router } from 'express';

import { requireAuth, requirePermission } from '../middleware/auth.js';
import { ACCESS_LEVELS } from '../utils/permissions.js';
import {
  getPackingExceptionsReport,
  getPackingProductionReport,
  getPackingReconciliationReport,
  getPackingStockReport,
  getPackingVarianceReport,
  normalizeReportError,
} from '../services/packingReports/index.js';
import { traceBarcodeHistory } from '../services/packingLineage/index.js';

const router = Router();
const barcodeHistoryRouter = Router();
const PERM_READ = ACCESS_LEVELS.READ;

function sendError(res, error, fallbackCode, fallbackMessage) {
  const normalized = normalizeReportError(error);
  const status = normalized?.code === 'invalid_report_request' || normalized?.code === 'invalid_barcode' ? 400 : 500;
  return res.status(status).json({
    error: normalized?.code || fallbackCode,
    message: normalized?.message || fallbackMessage,
    details: normalized?.details || null,
  });
}

async function reportHandler(getReport, req, res, fallbackCode, fallbackMessage) {
  try {
    return res.json(await getReport(req.query || {}));
  } catch (error) {
    console.error(`Packing report ${fallbackCode} failed`, error);
    return sendError(res, error, fallbackCode, fallbackMessage);
  }
}

async function barcodeHistoryHandler(req, res) {
  try {
    const rawTree = req.query?.tree;
    const tree = rawTree === '1' || rawTree === 'true' || rawTree === 'yes';
    const history = await traceBarcodeHistory(req.params.barcode, { tree });
    if (!tree) {
      delete history.tree;
      delete history.stats;
    }
    return res.json({ history });
  } catch (error) {
    console.error('Packing barcode lineage failed', error);
    return sendError(res, error, 'packing_lineage_failed', 'Unable to load barcode lineage');
  }
}

function protect(routerInstance) {
  routerInstance.use(requireAuth);
  routerInstance.use(requirePermission('reports', PERM_READ));
  return routerInstance;
}

protect(router);
protect(barcodeHistoryRouter);

router.get('/production', (req, res) => reportHandler(
  getPackingProductionReport,
  req,
  res,
  'packing_production_report_failed',
  'Unable to load Packing production report',
));

router.get('/stock', (req, res) => reportHandler(
  getPackingStockReport,
  req,
  res,
  'packed_stock_report_failed',
  'Unable to load Packed Stock report',
));

router.get('/variance', (req, res) => reportHandler(
  getPackingVarianceReport,
  req,
  res,
  'packing_variance_report_failed',
  'Unable to load Packing variance report',
));

router.get('/exceptions', (req, res) => reportHandler(
  getPackingExceptionsReport,
  req,
  res,
  'packing_exceptions_report_failed',
  'Unable to load Packing exceptions report',
));

router.get('/reconciliation', (req, res) => reportHandler(
  getPackingReconciliationReport,
  req,
  res,
  'packing_reconciliation_report_failed',
  'Unable to load reconciliation report',
));

// This relative alias is useful when the default router is mounted at
// /api/packing-reports. WP-08 also mounts barcodeHistoryRouter at /api/reports
// so the existing barcode-history URL remains authoritative.
router.get('/barcode-history/:barcode', barcodeHistoryHandler);
router.get('/lineage/:barcode', barcodeHistoryHandler);
barcodeHistoryRouter.get('/barcode-history/:barcode', barcodeHistoryHandler);

export { barcodeHistoryRouter };
export default router;
