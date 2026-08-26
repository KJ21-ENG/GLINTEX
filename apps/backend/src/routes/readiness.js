import { Router } from 'express';
import { checkBackendReadiness } from '../services/cutover/readiness.js';

const router = Router();

async function handleReadiness(req, res) {
  try {
    const result = await checkBackendReadiness();
    return res.status(result.ok ? 200 : 503).json(result);
  } catch (error) {
    console.error('[Readiness] Readiness handler failed:', error?.message || error);
    return res.status(503).json({
      ok: false,
      status: 'not_ready',
      deploySha: process.env.GLINTEX_DEPLOY_SHA || null,
      error: 'readiness_check_failed',
    });
  }
}

router.get('/api/readiness', handleReadiness);
router.get('/readiness', handleReadiness);

export { handleReadiness };
export default router;
