const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function prepareUpdateHost() {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw Error('Build the Windows updater host on the approved Windows x64 runner');
  const root=path.resolve(__dirname,'../../..'), source=path.resolve(__dirname,'../src/updates/WindowsUpdateHost.cs');
  const manifest=path.resolve(__dirname,'../src/updates/WindowsUpdateHost.manifest'), directory=path.resolve(__dirname,'../build/update-host');
  fs.mkdirSync(directory,{recursive:true});
  const exe=path.join(directory,'GLINTEXUpdateHost.exe');
  const compiler=path.win32.join(process.env.SystemRoot || 'C:\\Windows','Microsoft.NET','Framework64','v4.0.30319','csc.exe');
  execFileSync(compiler,['/nologo','/target:winexe','/platform:x64','/optimize+','/out:'+exe,'/win32manifest:'+manifest,source],{stdio:'inherit'});
  const identity={sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),sourceSha256:sha(source),manifestSha256:sha(manifest),binarySha256:sha(exe),bytes:fs.statSync(exe).size};
  fs.writeFileSync(path.join(directory,'identity.json'),JSON.stringify(identity,null,2)+'\n');
  return directory;
}
if(require.main===module)prepareUpdateHost();
module.exports={prepareUpdateHost};
