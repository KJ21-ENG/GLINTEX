import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertExternalIntegrationAllowed,
  assertRuntimeSafety,
  externalIntegrationBlock,
  getRuntimeSafety,
} from '../runtimeSafety.js';

test('staging fails closed unless external integrations are explicitly disabled', () => {
  assert.throws(
    () => assertRuntimeSafety({ GLINTEX_RUNTIME_MODE: 'staging' }),
    (error) => error.code === 'STAGING_RUNTIME_UNSAFE',
  );
});

test('safe staging blocks every external integration', () => {
  const env = { GLINTEX_RUNTIME_MODE: 'staging', EXTERNAL_INTEGRATIONS_DISABLED: 'true' };
  assert.deepEqual(getRuntimeSafety(env), {
    runtimeMode: 'staging',
    isStaging: true,
    externalIntegrationsDisabled: true,
    externalIntegrationsAllowed: false,
  });
  assert.throws(
    () => assertExternalIntegrationAllowed('telegram', env),
    (error) => error.code === 'EXTERNAL_INTEGRATION_DISABLED' && error.integration === 'telegram',
  );
  assert.deepEqual(externalIntegrationBlock('google_drive', env), {
    ok: false,
    skipped: true,
    reason: 'external_integration_disabled',
    integration: 'google_drive',
    runtimeMode: 'staging',
  });
});

test('production behavior remains enabled unless the explicit kill switch is set', () => {
  assert.equal(getRuntimeSafety({ GLINTEX_RUNTIME_MODE: 'production' }).externalIntegrationsAllowed, true);
  assert.equal(getRuntimeSafety({ GLINTEX_RUNTIME_MODE: 'production', EXTERNAL_INTEGRATIONS_DISABLED: '1' }).externalIntegrationsAllowed, false);
});
