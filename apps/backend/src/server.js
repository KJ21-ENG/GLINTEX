import app from './app.js';
import whatsapp from '../whatsapp/service.js';

const PORT = process.env.PORT || 4000;

const server = app.listen(PORT, () => {
  console.log(`GLINTEX backend listening on http://localhost:${PORT}`);
});

async function startWhatsapp() {
  try {
    await whatsapp.init();
    console.log('Whatsapp service initialized');
  } catch (err) {
    console.error('Failed to initialize Whatsapp service', err);
  }
}

startWhatsapp();

export default server;
