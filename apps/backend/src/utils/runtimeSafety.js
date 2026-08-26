const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

export const STAGING_RUNTIME_MODE = 'staging';

function readFlag(value) {
  return TRUE_VALUES.has(String(value || '').trim().toLowerCase());
}

export function getRuntimeSafety(env = process.env) {
  const runtimeMode = String(env.GLINTEX_RUNTIME_MODE || 'development').trim().toLowerCase();
  const externalIntegrationsDisabled = readFlag(env.EXTERNAL_INTEGRATIONS_DISABLED);
  return {
    runtimeMode,
    isStaging: runtimeMode === STAGING_RUNTIME_MODE,
    externalIntegrationsDisabled,
    externalIntegrationsAllowed: runtimeMode !== STAGING_RUNTIME_MODE && !externalIntegrationsDisabled,
  };
}

export function assertRuntimeSafety(env = process.env) {
  const safety = getRuntimeSafety(env);
  if (safety.isStaging && !safety.externalIntegrationsDisabled) {
    const error = new Error('staging_requires_external_integrations_disabled');
    error.code = 'STAGING_RUNTIME_UNSAFE';
    throw error;
  }
  return safety;
}

export function assertExternalIntegrationAllowed(integration, env = process.env) {
  const safety = assertRuntimeSafety(env);
  if (!safety.externalIntegrationsAllowed) {
    const error = new Error(`${integration || 'external'}_disabled_by_runtime_safety`);
    error.code = 'EXTERNAL_INTEGRATION_DISABLED';
    error.integration = integration || 'external';
    throw error;
  }
  return safety;
}

export function externalIntegrationBlock(integration, env = process.env) {
  const safety = assertRuntimeSafety(env);
  if (safety.externalIntegrationsAllowed) return null;
  return {
    ok: false,
    skipped: true,
    reason: 'external_integration_disabled',
    integration,
    runtimeMode: safety.runtimeMode,
  };
}
