import React, { useCallback, useEffect, useState } from 'react';
import AccessDenied from '../components/common/AccessDenied';
import { usePermission } from '../hooks/usePermission';
import { listCustomers } from '../api';
import {
  createPackingBatch,
  getPackingBatch,
  getPackingLaunchState,
  listPackingBatches,
  listPackingPackageTypes,
  listPackingRecipes,
} from '../api/packing';
import { ErrorNotice, LoadingState, ReadOnlyNotice, SuccessNotice } from '../components/packing/PackingPrimitives';
import { PackingBatchForm } from '../components/packing/PackingBatchForm';
import { PackingBatchWorkspace } from '../components/packing/PackingBatchWorkspace';
import { PackingOverview } from '../components/packing/PackingOverview';
import { asArray, getNextCursor } from '../components/packing/packingUtils';

function responseCollection(response, keys = []) {
  for (const key of keys) {
    if (Array.isArray(response?.[key])) return response[key];
  }
  return asArray(response);
}

function responseEntity(response, key) {
  return response?.[key] || response?.data || response;
}

export function Packing({ onOpenSettings }) {
  const { canRead, canWrite } = usePermission('packing');
  const [batches, setBatches] = useState([]);
  const [recipes, setRecipes] = useState([]);
  const [packageTypes, setPackageTypes] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [launchState, setLaunchState] = useState(null);
  const [selectedBatch, setSelectedBatch] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadingBatch, setLoadingBatch] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState('');

  const loadReferenceData = useCallback(async () => {
    const results = await Promise.allSettled([
      listPackingRecipes({ limit: 100, status: 'ACTIVE' }),
      listPackingPackageTypes({ limit: 100, isActive: true }),
      listCustomers(),
      getPackingLaunchState(),
    ]);
    const [recipeResult, packageResult, customerResult, launchResult] = results;
    if (recipeResult.status === 'fulfilled') setRecipes(responseCollection(recipeResult.value, ['recipes', 'items']));
    if (packageResult.status === 'fulfilled') setPackageTypes(responseCollection(packageResult.value, ['packageTypes', 'package_types', 'items']));
    if (customerResult.status === 'fulfilled') setCustomers(responseCollection(customerResult.value, ['customers', 'items']));
    if (launchResult.status === 'fulfilled') setLaunchState(responseEntity(launchResult.value, 'launchState'));
    const failed = results.find((result) => result.status === 'rejected');
    if (failed) setError(failed.reason);
  }, []);

  const loadBatches = useCallback(async ({ reset = false } = {}) => {
    if (reset) setLoading(true);
    else setLoadingMore(true);
    try {
      const response = await listPackingBatches({ limit: 50, cursor: reset ? undefined : cursor });
      const nextBatches = responseCollection(response, ['batches', 'items']);
      setBatches((current) => reset ? nextBatches : [...current, ...nextBatches]);
      const nextCursor = getNextCursor(response);
      setCursor(nextCursor);
      setHasMore(!!nextCursor);
      setError(null);
    } catch (loadError) {
      setError(loadError);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [cursor]);

  const loadAll = useCallback(async () => {
    setError(null);
    await Promise.all([loadBatches({ reset: true }), loadReferenceData()]);
  }, [loadBatches, loadReferenceData]);

  useEffect(() => {
    if (canRead) loadAll();
  }, [canRead, loadAll]);

  const openBatch = async (batch) => {
    setError(null);
    setSuccess('');
    setLoadingBatch(true);
    try {
      const response = await getPackingBatch(batch.id || batch.batchId || batch.batchNo);
      setSelectedBatch(responseEntity(response, 'batch'));
      setShowCreate(false);
    } catch (loadError) {
      setError(loadError);
    } finally {
      setLoadingBatch(false);
    }
  };

  const handleCreate = async (payload) => {
    setSaving(true);
    setError(null);
    setSuccess('');
    try {
      const response = await createPackingBatch(payload);
      const nextBatch = responseEntity(response, 'batch');
      setShowCreate(false);
      setSuccess('Draft Packing batch created.');
      await loadBatches({ reset: true });
      if (nextBatch?.id || nextBatch?.batchNo) {
        await openBatch(nextBatch);
      }
    } catch (createError) {
      setError(createError);
      throw createError;
    } finally {
      setSaving(false);
    }
  };

  const handleMutated = async () => {
    await loadBatches({ reset: true });
  };

  if (!canRead) {
    return <AccessDenied message="You do not have access to Packing. Contact an administrator." />;
  }

  if (loading && !batches.length && !selectedBatch) {
    return <LoadingState label="Loading Packing workspace…" />;
  }

  if (selectedBatch) {
    return (
      <div className="space-y-4">
        <ErrorNotice error={error} onRetry={() => openBatch(selectedBatch)} />
        <PackingBatchWorkspace
          batch={selectedBatch}
          recipes={recipes}
          customers={customers}
          packageTypes={packageTypes}
          canWrite={canWrite}
          onBack={() => { setSelectedBatch(null); setError(null); setSuccess(''); }}
          onMutated={handleMutated}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ErrorNotice error={error} onRetry={loadAll} />
      <SuccessNotice>{success}</SuccessNotice>
      {launchState?.status && launchState.status !== 'ACTIVE' ? <ReadOnlyNotice>Launch state is {launchState.status}. Packing mutations remain subject to the server write gate.</ReadOnlyNotice> : null}
      {showCreate ? (
        <PackingBatchForm recipes={recipes} customers={customers} canWrite={canWrite} saving={saving} onSubmit={handleCreate} onCancel={() => setShowCreate(false)} />
      ) : (
        <PackingOverview
          batches={batches}
          loading={loading || loadingMore || loadingBatch}
          error={null}
          canWrite={canWrite}
          onRefresh={loadAll}
          onLoadMore={() => loadBatches()}
          hasMore={hasMore}
          onCreateBatch={() => { setSuccess(''); setShowCreate(true); }}
          onSelectBatch={openBatch}
          onOpenSettings={onOpenSettings}
        />
      )}
    </div>
  );
}

export default Packing;
