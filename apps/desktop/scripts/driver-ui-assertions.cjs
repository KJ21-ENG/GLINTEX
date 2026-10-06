const assert = require("node:assert/strict");
async function verifyDriverUI(evaluate) {
  const waitFor = async expression => {
    for (let i = 0; i < 100; i++) {
      if (await evaluate(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error("Driver UI fixture timed out: " + expression);
  };
  await waitFor(`!![...document.querySelectorAll('#panel button')].find(b => b.textContent === 'Prepare verified scale driver')`);
  const button = `[...document.querySelectorAll('#panel button')].find(b => b.textContent === 'Prepare verified scale driver')`;
  for (const [code, expected] of [[1, "Driver preparation failed"], [0, "Driver package verified"]]) {
    await evaluate(`window.fixtureDriverOutcome(${code}); ${button}.click()`);
    await waitFor(`document.querySelector('#panel').innerText.includes(${JSON.stringify(expected)}) && !${button}.disabled`);
    assert.match(await evaluate(`document.querySelector('#panel').textContent`), /SIMULATED/);
  }
  assert.equal(await evaluate("window.fixtureDriverCalls"), 2);
  assert.match(await evaluate("document.querySelector('#panel').textContent"), /Device Manager/);
  assert.match(await evaluate("document.querySelector('#panel').textContent"), /SIMULATED user profile\/scale-driver\/cache\/verified-package/);
  await evaluate(`window.fixtureScaleConnected(true); [...document.querySelectorAll('#panel button')].find(b => b.textContent === 'Refresh devices and jobs').click()`);
  await waitFor(`${button}.disabled`);
  await evaluate(`${button}.click()`);
  assert.equal(await evaluate("window.fixtureDriverCalls"), 2, "connected scale must prevent setup launch");
  return { helperOutcomes: ["verification failure", "prepared without installation"], connectedScaleBlocksSetup: true, realDriverExecuted: false };
}
module.exports = { verifyDriverUI };
