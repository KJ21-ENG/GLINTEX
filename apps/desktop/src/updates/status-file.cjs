const fs = require('node:fs/promises');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const isContention = error => ['EBUSY', 'EACCES', 'EPERM'].includes(error.code);

// Windows writers and scanners can briefly deny access. Only sharing/access
// failures are retryable; genuine I/O failures still stop the handoff.
async function retryStatusAccess(operation, { timeout = 3000, clock = Date.now, wait = delay } = {}) {
  const deadline = clock() + timeout;
  while (true) {
    try { return await operation(); }
    catch (error) {
      if (!isContention(error)) throw error;
      if (clock() >= deadline) throw new Error('Windows kept the update status file locked. GLINTEX remains open; retry the update.', { cause: error });
      await wait(100);
    }
  }
}

async function waitForHelper(child, statusFile, { parentPid, release }, { readFile = fs.readFile, timeout = 15000, clock = Date.now, wait = delay } = {}) {
  let failure, locked = false, acknowledged = false;
  const onError = error => { failure = error; };
  const onExit = code => { failure = new Error(`Update helper exited before acknowledgement (${code})`); };
  child.once('error', onError);
  child.once('exit', onExit);
  const deadline = clock() + timeout;
  try {
    while (clock() < deadline) {
      if (failure) throw failure;
      try {
        const text = await readFile(statusFile, 'utf8');
        if (failure) throw failure;
        locked = false;
        if (text.length <= 4096) {
          const status = JSON.parse(text.replace(/^\uFEFF/, ''));
          if (status.state === 'waiting' && status.parentPid === parentPid && status.version === release.version) {
            acknowledged = true;
            child.unref();
            return;
          }
          if (status.state === 'failed') throw new Error('The Windows update helper could not start. GLINTEX remains open.');
        }
      } catch (error) {
        if (isContention(error)) locked = true;
        else if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
      }
      await wait(100);
    }
    throw new Error(locked
      ? 'Windows kept the update status file locked. GLINTEX remains open; retry the update.'
      : 'The Windows update helper did not acknowledge startup. GLINTEX remains open.');
  } finally {
    child.removeListener('error', onError);
    child.removeListener('exit', onExit);
    if (!acknowledged) child.kill();
  }
}

module.exports = { retryStatusAccess, waitForHelper };
