const assert = require("node:assert/strict");
async function verifyDriverUI(evaluate) {
  const waitFor = async expression => {
    for (let i = 0; i < 100; i++) {
      if (await evaluate(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error("Driver UI fixture timed out: " + expression);
  };
  await waitFor(`!![...document.querySelectorAll('#panel button')].find(b => b.textContent === 'Run scale driver setup (administrator)')`);
  const button = `[...document.querySelectorAll('#panel button')].find(b => b.textContent === 'Run scale driver setup (administrator)')`;
  for (const [code, expected] of [[1, "Driver setup failed or administrator approval was cancelled"], [3010, "Windows requests a restart"], [0, "Driver setup finished"]]) {
    await evaluate(`window.fixtureDriverOutcome(${code}); ${button}.click()`);
    await waitFor(`document.querySelector('#panel').innerText.includes(${JSON.stringify(expected)}) && !${button}.disabled`);
    assert.match(await evaluate(`document.querySelector('#panel').textContent`), /SIMULATED/);
  }
  assert.equal(await evaluate("window.fixtureDriverCalls"), 3);
  await evaluate(`window.fixtureScaleConnected(true); [...document.querySelectorAll('#panel button')].find(b => b.textContent === 'Refresh devices and jobs').click()`);
  await waitFor(`${button}.disabled`);
  await evaluate(`${button}.click()`);
  assert.equal(await evaluate("window.fixtureDriverCalls"), 3, "connected scale must prevent setup launch");
  return { helperOutcomes: ["failure/cancellation", "restart requested", "healthy retained"], connectedScaleBlocksSetup: true, realDriverExecuted: false };
}
module.exports = { verifyDriverUI };
