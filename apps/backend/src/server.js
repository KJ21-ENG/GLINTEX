import app from './app.js';
import whatsapp from '../whatsapp/service.js';
import { ensureDefaultAdminUser } from './utils/defaultAdmin.js';

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

  startWhatsapp();
}

start();

export default server;
