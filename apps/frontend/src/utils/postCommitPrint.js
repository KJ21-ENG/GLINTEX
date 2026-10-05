// Commit/reset is completed before optional printing. Printing never retries a save.
export async function runPostCommitPrint({ finalize, print, onFailure }) {
  finalize();
  try {
    const result = await print();
    if (result?.success === false) throw new Error(result.error || 'Printer rejected the label');
    return { printStepCompleted: true, result };
  } catch (error) {
    onFailure(error);
    return { printStepCompleted: false, error };
  }
}

// A confirmed mutation must never be reported as failed because its refresh failed.
export async function refreshAfterCommit(refresh) {
  try { return { value: await refresh(), warning: null }; }
  catch (error) { return { value: null, warning: error?.message || 'Saved data refresh unavailable' }; }
}
