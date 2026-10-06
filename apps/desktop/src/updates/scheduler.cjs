const CHECK_INTERVAL = 6 * 60 * 60 * 1000;
const RETRY_DELAYS = [30000, 120000, 300000, 900000];

// Discovery only. Downloading, arming and installation remain explicit choices.
class UpdateScheduler {
  constructor({ updater, setTimer = setTimeout, clearTimer = clearTimeout }) {
    Object.assign(this, { updater, setTimer, clearTimer });
    this.retryIndex = 0;
    this.onStatus = status => this.schedule(status);
  }

  start() {
    if (this.running || !this.updater.supported) return;
    this.running = true;
    this.updater.on('status', this.onStatus);
    const status = this.updater.status();
    // A successful session response during page loading may already have checked.
    if (status.checkedAt == null) void this.updater.check();
    else this.schedule(status);
  }

  schedule(status) {
    this.clearTimer(this.timer);
    this.timer = null;
    if (!this.running || ['idle', 'checking', 'downloading', 'armed', 'installing', 'unsupported'].includes(status.state)) return;
    let delay = CHECK_INTERVAL;
    if (['error', 'unavailable'].includes(status.state)) {
      delay = RETRY_DELAYS[Math.min(this.retryIndex++, RETRY_DELAYS.length - 1)];
    } else {
      this.retryIndex = 0;
    }
    this.timer = this.setTimer(() => {
      this.timer = null;
      if (this.running) void this.updater.check();
    }, delay);
  }

  retry() {
    if (!this.running || !['idle', 'error', 'signin', 'unavailable'].includes(this.updater.status().state)) return Promise.resolve(this.updater.status());
    return this.updater.check();
  }

  stop() {
    this.running = false;
    this.clearTimer(this.timer);
    this.timer = null;
    this.updater.removeListener('status', this.onStatus);
  }
}

module.exports = { UpdateScheduler, CHECK_INTERVAL, RETRY_DELAYS };
