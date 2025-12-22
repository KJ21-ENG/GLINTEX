import { randomUUID } from 'crypto';
import fs from 'fs';
import { google } from 'googleapis';
import prisma from '../lib/prisma.js';

const DRIVE_FOLDER_NAME = 'GLINTEX_Backups';
const DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/userinfo.email',
];
const STATE_TTL_MS = 10 * 60 * 1000;
const DRIVE_CREDENTIAL_ID = 1;
const pendingStates = new Map();

function pruneExpiredStates() {
  const now = Date.now();
  for (const [state, expiresAt] of pendingStates.entries()) {
    if (expiresAt <= now) pendingStates.delete(state);
  }
}

function getGoogleDriveConfig() {
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_DRIVE_REDIRECT_URI;
  const missing = [];
  if (!clientId) missing.push('GOOGLE_DRIVE_CLIENT_ID');
  if (!clientSecret) missing.push('GOOGLE_DRIVE_CLIENT_SECRET');
  if (!redirectUri) missing.push('GOOGLE_DRIVE_REDIRECT_URI');
  return {
    configured: missing.length === 0,
    missing,
    clientId,
    clientSecret,
    redirectUri,
  };
}

function createOAuthClient() {
  const config = getGoogleDriveConfig();
  if (!config.configured) {
    throw new Error(`Google Drive OAuth is not configured (missing ${config.missing.join(', ')})`);
  }
  return new google.auth.OAuth2(config.clientId, config.clientSecret, config.redirectUri);
}

function consumeState(state) {
  if (!state) return false;
  pruneExpiredStates();
  const expiresAt = pendingStates.get(state);
  if (!expiresAt || expiresAt <= Date.now()) {
    pendingStates.delete(state);
    return false;
  }
  pendingStates.delete(state);
  return true;
}

async function ensureBackupFolder(drive, existingFolderId) {
  if (existingFolderId) {
    try {
      await drive.files.get({ fileId: existingFolderId, fields: 'id' });
      return existingFolderId;
    } catch (err) {
      // Folder might be removed or inaccessible; fall through to create a new one.
    }
  }

  const list = await drive.files.list({
    q: `mimeType='application/vnd.google-apps.folder' and name='${DRIVE_FOLDER_NAME}' and trashed=false`,
    fields: 'files(id,name)',
    spaces: 'drive',
  });

  if (list.data.files && list.data.files.length > 0) {
    return list.data.files[0].id;
  }

  const created = await drive.files.create({
    requestBody: {
      name: DRIVE_FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
    },
    fields: 'id',
  });

  return created.data.id;
}

async function persistTokens(tokens) {
  if (!tokens) return;
  const existing = await prisma.googleDriveCredential.findUnique({
    where: { id: DRIVE_CREDENTIAL_ID },
  });
  const refreshToken = tokens.refresh_token || existing?.refreshToken;
  if (!refreshToken) return;

  await prisma.googleDriveCredential.upsert({
    where: { id: DRIVE_CREDENTIAL_ID },
    update: {
      refreshToken,
      accessToken: tokens.access_token || existing?.accessToken || null,
      tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : existing?.tokenExpiry || null,
    },
    create: {
      id: DRIVE_CREDENTIAL_ID,
      refreshToken,
      accessToken: tokens.access_token || null,
      tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      email: null,
      folderId: null,
    },
  });
}

async function getUserEmail(oauth2Client) {
  try {
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const res = await oauth2.userinfo.get();
    return res.data?.email || null;
  } catch (err) {
    return null;
  }
}

async function getDriveClient() {
  const config = getGoogleDriveConfig();
  if (!config.configured) {
    return { configured: false, drive: null, oauth2Client: null, credential: null };
  }

  const credential = await prisma.googleDriveCredential.findUnique({
    where: { id: DRIVE_CREDENTIAL_ID },
  });
  if (!credential || !credential.refreshToken) {
    return { configured: true, drive: null, oauth2Client: null, credential };
  }

  const oauth2Client = createOAuthClient();
  oauth2Client.setCredentials({
    refresh_token: credential.refreshToken,
    access_token: credential.accessToken || undefined,
    expiry_date: credential.tokenExpiry ? new Date(credential.tokenExpiry).getTime() : undefined,
  });
  oauth2Client.on('tokens', (tokens) => {
    persistTokens(tokens).catch(err => console.error('[GoogleDrive] Failed to persist tokens', err));
  });

  const drive = google.drive({ version: 'v3', auth: oauth2Client });
  return { configured: true, drive, oauth2Client, credential };
}

async function pruneOldDriveBackups(drive, folderId, keepCount = 3) {
  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed=false and name contains '.dump'`,
    orderBy: 'createdTime desc',
    fields: 'files(id,name,createdTime)',
    spaces: 'drive',
  });

  const files = res.data.files || [];
  const toDelete = files.slice(keepCount);
  for (const file of toDelete) {
    try {
      await drive.files.delete({ fileId: file.id });
    } catch (err) {
      console.warn('[GoogleDrive] Failed to delete old backup', file.id, err.message || err);
    }
  }

  return { deletedCount: toDelete.length };
}

export function createGoogleDriveAuthUrl() {
  const oauth2Client = createOAuthClient();
  const state = randomUUID();
  pruneExpiredStates();
  pendingStates.set(state, Date.now() + STATE_TTL_MS);

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: DRIVE_SCOPES,
    state,
  });

  return { authUrl };
}

export async function handleGoogleDriveCallback({ code, state }) {
  if (!consumeState(state)) {
    throw new Error('Invalid or expired OAuth state. Please try connecting again.');
  }

  const oauth2Client = createOAuthClient();
  const { tokens } = await oauth2Client.getToken(code);
  if (!tokens) {
    throw new Error('Failed to retrieve Google Drive tokens.');
  }

  oauth2Client.setCredentials(tokens);
  const email = await getUserEmail(oauth2Client);
  const drive = google.drive({ version: 'v3', auth: oauth2Client });

  const existing = await prisma.googleDriveCredential.findUnique({
    where: { id: DRIVE_CREDENTIAL_ID },
  });
  const refreshToken = tokens.refresh_token || existing?.refreshToken;
  if (!refreshToken) {
    throw new Error('Missing refresh token. Disconnect and reconnect to authorize again.');
  }

  const folderId = await ensureBackupFolder(drive, existing?.folderId);

  await prisma.googleDriveCredential.upsert({
    where: { id: DRIVE_CREDENTIAL_ID },
    update: {
      refreshToken,
      accessToken: tokens.access_token || existing?.accessToken || null,
      tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : existing?.tokenExpiry || null,
      email,
      folderId,
    },
    create: {
      id: DRIVE_CREDENTIAL_ID,
      refreshToken,
      accessToken: tokens.access_token || null,
      tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      email,
      folderId,
    },
  });

  return { email, folderId };
}

export async function disconnectGoogleDrive() {
  try {
    await prisma.googleDriveCredential.delete({ where: { id: DRIVE_CREDENTIAL_ID } });
  } catch (err) {
    if (err?.code !== 'P2025') throw err;
  }
}

export async function getGoogleDriveStatus() {
  const config = getGoogleDriveConfig();
  if (!config.configured) {
    return { connected: false, configured: false, missing: config.missing };
  }

  const credential = await prisma.googleDriveCredential.findUnique({
    where: { id: DRIVE_CREDENTIAL_ID },
  });
  if (!credential || !credential.refreshToken) {
    return { connected: false, configured: true };
  }

  return {
    connected: true,
    configured: true,
    email: credential.email,
    folderId: credential.folderId,
    connectedAt: credential.createdAt,
  };
}

export async function uploadBackupToDrive({ filepath, filename }) {
  const { configured, drive, credential } = await getDriveClient();

  if (!configured) {
    return { success: false, skipped: true, reason: 'not_configured' };
  }
  if (!drive || !credential) {
    return { success: false, skipped: true, reason: 'not_connected' };
  }

  const folderId = await ensureBackupFolder(drive, credential.folderId);
  if (folderId && folderId !== credential.folderId) {
    await prisma.googleDriveCredential.update({
      where: { id: DRIVE_CREDENTIAL_ID },
      data: { folderId },
    });
  }

  const res = await drive.files.create({
    requestBody: {
      name: filename,
      parents: [folderId],
    },
    media: {
      mimeType: 'application/octet-stream',
      body: fs.createReadStream(filepath),
    },
    fields: 'id,name,createdTime',
  });

  const pruneResult = await pruneOldDriveBackups(drive, folderId, 3);

  return {
    success: true,
    fileId: res.data.id,
    fileName: res.data.name,
    createdTime: res.data.createdTime,
    pruned: pruneResult.deletedCount,
  };
}
