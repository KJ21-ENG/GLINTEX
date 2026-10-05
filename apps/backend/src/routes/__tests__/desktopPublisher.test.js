import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { publishDesktopRelease } from '../../../scripts/publish-desktop-release.mjs';
test('publisher verifies private candidate, rejects higher fixture/failed tests and keeps published versions immutable', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'glintex-publisher-')); t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const delivery = path.join(root,'delivery'), directory = path.join(root,'private'), verification = path.join(root,'windows.json'); await fs.mkdir(delivery);
  const bytes = Buffer.from('fixture'), sourceCommit = 'a'.repeat(40), name = 'GLINTEX-1.1.0-x64-Setup.exe';
  const manifest = { version:'1.1.0', sourceCommit, signing:'unsigned-test-installer', files:[{name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}] };
  await fs.writeFile(path.join(delivery,'manifest.json'),JSON.stringify(manifest)); await fs.writeFile(path.join(delivery,name),bytes);
  const identity = {sourceCommit,sourceTree:'b'.repeat(40),signing:manifest.signing,repository:'KJ21-ENG/GLINTEX-desktop-builds',runId:'123',runAttempt:'1'};
  await fs.writeFile(path.join(delivery,'release-identity.json'),JSON.stringify(identity));
  const report = {passed:true,packagedLaunch:true,installedLaunch:true,upgradePreserved:true,authenticatedUpdate:true,manualBootstrapPreserved:true,reinstallPreserved:true,uninstall:true,bootstrapTo:'1.1.0',sourceCommit,sourceTree:identity.sourceTree,repository:identity.repository,runId:identity.runId,runAttempt:identity.runAttempt,installerSha256:manifest.files[0].sha256,installerBytes:bytes.length};
  const args = {delivery,verification,directory,notes:'fixture only'};
  await fs.writeFile(verification,JSON.stringify({...report,passed:false})); await assert.rejects(publishDesktopRelease(args),/Verified/);
  await fs.writeFile(verification,JSON.stringify({...report,bootstrapTo:'1.1.1'})); await assert.rejects(publishDesktopRelease(args),/Verified/);
  for(const patch of [{sourceCommit:'c'.repeat(40)},{installerSha256:'c'.repeat(64)},{runId:'other'},{sourceTree:'c'.repeat(40)},{installerBytes:bytes.length+1}]) { await fs.writeFile(verification,JSON.stringify({...report,...patch})); await assert.rejects(publishDesktopRelease(args),/evidence/); }
  for(const sourceTree of [undefined, 'invalid']) {
    await fs.writeFile(path.join(delivery,'release-identity.json'),JSON.stringify({...identity,sourceTree}));
    await fs.writeFile(verification,JSON.stringify({...report,sourceTree}));
    await assert.rejects(publishDesktopRelease(args),/evidence/);
  }
  await fs.writeFile(path.join(delivery,'release-identity.json'),JSON.stringify(identity));
  await fs.writeFile(verification,JSON.stringify(report)); await fs.writeFile(path.join(delivery,name),'wrong'); await assert.rejects(publishDesktopRelease(args),/integrity/);
  await fs.writeFile(path.join(delivery,name),bytes); const release = await publishDesktopRelease(args); assert.equal(release.version,'1.1.0');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory,'latest.json'))),{version:'1.1.0'});
  await assert.rejects(publishDesktopRelease(args),{code:'EEXIST'}); assert.ok((await fs.readFile(path.join(directory,'1.1.0',name))).equals(bytes));
});
