const assert = require('node:assert/strict');
async function verifyUpdateUI(evaluate) {
  const click = async text => { assert.equal(await evaluate(`(()=>{const b=[...document.querySelectorAll('[aria-label="Application updates"] button')].find(b=>b.textContent===${JSON.stringify(text)});if(!b||b.disabled)return false;b.click();return true})()`), true, text); };
  const wait = async text => { for (let n=0;n<100;n++) { if (await evaluate(`document.querySelector('[aria-label="Application updates"]').innerText.includes(${JSON.stringify(text)})`)) return; await new Promise(r=>setTimeout(r,50)); } throw Error('Update UI did not show '+text); };
  await click('Check for updates'); await wait('Release 1.1.1');
  assert.equal(await evaluate('window.fixtureUpdateChoice'), 0);
  await click('Later'); assert.equal(await evaluate('window.glintexDesktop.updates.status().then(s=>s.prompt)'), false);
  await click('Download update'); await wait('Install after I close GLINTEX');
  assert.equal(await evaluate('window.fixtureUpdateChoice'), 0);
  await click('Install after I close GLINTEX'); await wait('Cancel installation choice');
  await click('Cancel installation choice'); await wait('Installation cancelled.');
  return { passed: true, checks: ['version-release-notes','manual-check','later','explicit-download','explicit-install-choice','cancel-install-choice'], simulated: true, installedAnything: false };
}
module.exports = { verifyUpdateUI };
