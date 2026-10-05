import test from 'node:test';
import assert from 'node:assert/strict';
import { runPostCommitPrint } from '../postCommitPrint.js';
for (const mode of ['template rejected', 'printer rejected', 'success:false']) {
  test(`committed receipt finalized once and failure visible: ${mode}`, async () => {
    const cart = [{ id: 'one' }]; let saves = 0, finalized = 0; const errors = [], order = [];
    async function save() {
      if (!cart.length) return;
      saves++; order.push('saved');
      await runPostCommitPrint({
        finalize: () => { cart.length = 0; finalized++; order.push('reset'); },
        print: async () => { order.push('print'); if (mode === 'success:false') return { success: false, error: mode }; throw new Error(mode); },
        onFailure: error => errors.push(`Saved but printing failed: ${error.message}`),
      });
    }
    await save(); await save();
    assert.equal(saves, 1); assert.equal(finalized, 1); assert.equal(errors.length, 1);
    assert.deepEqual(order, ['saved', 'reset', 'print']); assert.match(errors[0], /Saved but printing failed/);
  });
}
test('successful label never creates a second transaction', async () => {
  let finalized = 0; const result = await runPostCommitPrint({ finalize: () => finalized++, print: async () => ({ success: true }), onFailure: () => assert.fail() });
  assert.equal(finalized, 1); assert.equal(result.printStepCompleted, true);
});
