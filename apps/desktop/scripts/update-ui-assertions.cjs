const assert = require('node:assert/strict');
async function verifyUpdateUI(evaluate) {
  const click = async text => { assert.equal(await evaluate(`(()=>{const b=[...document.querySelectorAll('[aria-label="Application updates"] button')].find(b=>b.textContent===${JSON.stringify(text)});if(!b||b.disabled)return false;b.click();return true})()`), true, text); };
  const wait = async text => { for (let n=0;n<100;n++) { if (await evaluate(`document.querySelector('[aria-label="Application updates"]').innerText.includes(${JSON.stringify(text)})`)) return; await new Promise(r=>setTimeout(r,50)); } throw Error('Update UI did not show '+text); };
  await evaluate("[...document.querySelectorAll('#panel button')].find(b=>b.textContent.includes('Workstation setup')).click()");
  for (const [state,message] of [['current','No newer version'],['signin','Sign in again'],['unavailable','hosting is unavailable'],['error','Check your connection']]) {
    await evaluate(`window.fixtureUpdateFeedback(${JSON.stringify(state)})`); await wait(message);
    await click(state === 'error' ? 'Later' : 'Dismiss');
    await new Promise(resolve=>setTimeout(resolve,50));
    assert.equal(await evaluate("document.querySelector('[aria-label=\"Application updates\"]')===null"),true);
  }
  await evaluate("[...document.querySelectorAll('#panel button')].find(b=>b.textContent.includes('Workstation setup')).click()");
  await click('Check for updates'); await wait('Release 1.1.1');
  assert.equal(await evaluate('window.fixtureUpdateChoice'), 0);
  await click('Later'); assert.equal(await evaluate('window.glintexDesktop.updates.status().then(s=>s.prompt)'), false);
  await click('Download update'); await wait('Install after I close GLINTEX');
  assert.equal(await evaluate('window.fixtureUpdateChoice'), 0);
  await click('Install after I close GLINTEX'); await wait('Cancel installation choice');
  await click('Cancel installation choice'); await wait('Installation cancelled.');
  return { passed: true, checks: ['version-release-notes','manual-check','closed-panel-current-signin-unavailable-offline-feedback','later','explicit-download','explicit-install-choice','cancel-install-choice'], simulated: true, installedAnything: false };
}
module.exports = { verifyUpdateUI };
