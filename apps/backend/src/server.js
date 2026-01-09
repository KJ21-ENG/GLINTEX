import app from './app.js';
import whatsapp from '../whatsapp/service.js';
import { ensureDefaultAdminUser } from './utils/defaultAdmin.js';
import { initBackupScheduler } from './utils/backup.js';

const PORT = process.env.PORT || 4000;
const isDemoMode = process.env.DEMO_MODE === 'true';

let server = null;

async function startWhatsapp() {
  try {
    await whatsapp.init();
    console.log('Whatsapp service initialized');
  } catch (err) {
    console.error('Failed to initialize Whatsapp service', err);
  }
}

async function start() {
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

  if (isDemoMode) {
    console.log('Demo mode: WhatsApp and Backup services disabled');
  } else {
    startWhatsapp();
    await initBackupScheduler();
  }
}

start();

export default server;
