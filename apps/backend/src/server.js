import app from './app.js';
import whatsapp from '../whatsapp/service.js';
import telegram from '../telegram/service.js';
import { ensureDefaultAdminUser } from './utils/defaultAdmin.js';
import { initBackupScheduler } from './utils/backup.js';
import { initTelegramCronScheduler } from './utils/telegramScheduler.js';
import { assertRuntimeSafety } from './utils/runtimeSafety.js';

const PORT = process.env.PORT || 4000;

let server = null;

async function startWhatsapp() {
  try {
    await whatsapp.init();
    console.log('Whatsapp service initialized');
  } catch (err) {
    console.error('Failed to initialize Whatsapp service', err);
  }
}

async function startTelegram() {
  try {
    await telegram.init();
    console.log('Telegram service initialized');
  } catch (err) {
    console.error('Failed to initialize Telegram service', err);
  }
}

async function start() {
  const runtimeSafety = assertRuntimeSafety();
  try {
    const result = await ensureDefaultAdminUser();
    if (result?.created) {
      console.log('============================================================');
      console.log('GLINTEX DEFAULT ADMIN CREATED');
      console.log('Username:', result.username);
      if (result.passwordSource === 'default') {
        console.log('Password:', result.password);
      } else {
        console.log('Password: (set via DEFAULT_ADMIN_PASSWORD)');
      }
      console.log('============================================================');
    }
  } catch (err) {
    console.error('Failed to ensure default admin user', err);
  }

  server = app.listen(PORT, () => {
    console.log(`GLINTEX backend listening on http://localhost:${PORT}`);
  });

  if (runtimeSafety.externalIntegrationsAllowed) {
    startWhatsapp();
    startTelegram();
  } else {
    console.log(`[RuntimeSafety] External services disabled for ${runtimeSafety.runtimeMode}`);
  }
  await initBackupScheduler();
  if (runtimeSafety.externalIntegrationsAllowed) {
    await initTelegramCronScheduler();
  }
}

start();

export default server;
