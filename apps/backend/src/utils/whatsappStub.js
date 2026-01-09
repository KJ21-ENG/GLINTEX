import EventEmitter from 'events';

const emitter = new EventEmitter();

const whatsappStub = {
  client: null,
  init: async () => {},
  getStatus: () => ({
    status: 'disabled',
    hasQr: false,
    initializing: false,
    mobile: null,
  }),
  getQrDataUrl: () => null,
  getEmitter: () => emitter,
  logout: async () => {},
  sendText: async () => ({ ok: false, reason: 'demo_mode' }),
  sendTextSafe: async () => ({ ok: false, reason: 'demo_mode' }),
  sendToChatIdSafe: async () => ({ ok: false, reason: 'demo_mode' }),
};

export default whatsappStub;
