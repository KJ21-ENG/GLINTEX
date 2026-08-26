import assert from 'node:assert/strict';
import test from 'node:test';
import { assertChallanCanBeVoided, assertLegacyChallanMutationAllowed, assertLegacyDispatchMutationAllowed, formatDispatchCsvWeight, legacyDispatchChallanNoFromSyntheticId, legacyDispatchIdFromSyntheticLineId, preflightDispatchV2Mutation } from '../dispatchService.js';
import { DISPATCH_EVENT_TYPES } from '../common.js';
import { isWholePackedDispatch } from '../sourceAdapters.js';
import { formatDispatchPdfNumber } from '../../../utils/pdf/dispatchChallanPdf.js';

test('a whole Packed Dispatch cannot bypass validation when partial fields are supplied', () => {
  assert.equal(isWholePackedDispatch({ count: 6, weight: 0.75, sourceCount: 6, sourceWeight: 0.75 }), true);
  assert.equal(isWholePackedDispatch({
    count: 6,
    weight: 0.75,
    sourceCount: 6,
    sourceWeight: 0.75,
    residualBaseCount: 7,
    residualNetWeightKg: 0.875,
    damagedLostBaseCount: 0,
    damagedLostNetWeightKg: 0,
  }), false);
});

test('void preflight rejects any challan containing a returned line before restoration', () => {
  assert.throws(
    () => assertChallanCanBeVoided({
      lines: [
        { id: 'line-active', events: [] },
        { id: 'line-returned', events: [{ type: DISPATCH_EVENT_TYPES.LINE_RETURNED, createdAt: new Date() }] },
      ],
    }),
    (error) => error?.code === 'dispatch_line_returned' && error?.details?.lineId === 'line-returned',
  );
  assert.doesNotThrow(() => assertChallanCanBeVoided({
    lines: [{ id: 'line-reversed', events: [{ type: DISPATCH_EVENT_TYPES.RETURN_REVERSED, createdAt: new Date() }] }],
  }));
});

test('Dispatch PDF and CSV weight exports preserve the three-decimal contract', () => {
  assert.equal(formatDispatchPdfNumber(1.25), '1.250');
  assert.equal(formatDispatchCsvWeight('1.275'), '1.275');
  assert.equal(formatDispatchCsvWeight(0.7), '0.700');
});

test('legacy Dispatch reconstruction mutation errors remain stable conflicts', () => {
  assert.equal(legacyDispatchIdFromSyntheticLineId('historical:legacy-1'), 'legacy-1');
  assert.equal(legacyDispatchIdFromSyntheticLineId('legacy-1'), 'legacy-1');
  assert.equal(legacyDispatchChallanNoFromSyntheticId('legacy:DC/25-26/004'), 'DC/25-26/004');
  assert.equal(legacyDispatchChallanNoFromSyntheticId('dispatch-challan-1'), null);
  assert.throws(
    () => assertLegacyDispatchMutationAllowed({ id: 'legacy-1', challanNo: 'DC/25-26/004' }),
    (error) => error?.code === 'legacy_dispatch_read_only'
      && error?.statusCode === 409
      && error?.details?.challanNo === 'DC/25-26/004',
  );
  assert.doesNotThrow(() => assertLegacyDispatchMutationAllowed(null));
});

test('synthetic legacy challans are rejected before ordinary V2 lookup', async () => {
  let lookup;
  await assert.rejects(
    () => assertLegacyChallanMutationAllowed({
      dispatch: {
        findFirst: async (args) => {
          lookup = args;
          return { id: 'legacy-row-1', challanNo: 'DC/25-26/004' };
        },
      },
    }, 'legacy:DC/25-26/004'),
    (error) => error?.code === 'legacy_dispatch_read_only'
      && error?.statusCode === 409
      && error?.details?.legacyDispatchId === 'legacy-row-1'
      && error?.details?.challanNo === 'DC/25-26/004',
  );
  assert.deepEqual(lookup.where, { challanNo: 'DC/25-26/004', v2Line: null });
  assert.deepEqual(lookup.select, { id: true, challanNo: true });
});

test('Dispatch mutation preflight rejects synthetic history before the generic gate and leaves genuine V2 lines gated', async () => {
  const client = {
    dispatch: {
      findFirst: async () => ({ id: 'legacy-row-1', challanNo: 'DC/25-26/004' }),
      findUnique: async () => ({ id: 'legacy-row-1', challanNo: 'DC/25-26/004' }),
    },
  };
  const legacyReturn = () => preflightDispatchV2Mutation({ path: '/api/v2/dispatch/lines/historical:legacy-row-1/return' }, { client });
  const first = await legacyReturn().catch((error) => ({ code: error.code, statusCode: error.statusCode, details: error.details }));
  const replay = await legacyReturn().catch((error) => ({ code: error.code, statusCode: error.statusCode, details: error.details }));
  assert.deepEqual(first, replay);
  assert.equal(first.code, 'legacy_dispatch_read_only');
  assert.equal(first.statusCode, 409);

  await assert.rejects(
    () => preflightDispatchV2Mutation({ path: '/api/v2/dispatch/challans/legacy:DC%2F25-26%2F004/void' }, { client }),
    (error) => error?.code === 'legacy_dispatch_read_only' && error?.details?.challanNo === 'DC/25-26/004',
  );

  let genuineLookupCount = 0;
  await assert.doesNotReject(() => preflightDispatchV2Mutation(
    { path: '/api/v2/dispatch/lines/v2-line-1/return' },
    { client: { dispatch: { findUnique: async () => { genuineLookupCount += 1; return null; } } } },
  ));
  assert.equal(genuineLookupCount, 0);
});
