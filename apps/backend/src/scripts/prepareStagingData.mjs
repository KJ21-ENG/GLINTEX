import fs from 'fs';

import prisma from '../lib/prisma.js';
import { hashPassword } from '../utils/auth.js';
import { ACCESS_LEVELS, normalizePermissions } from '../utils/permissions.js';
import { assertRuntimeSafety } from '../utils/runtimeSafety.js';

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name}_required`);
  return value;
}

function readPassword(fileEnvName) {
  const filepath = required(fileEnvName);
  const password = fs.readFileSync(filepath, 'utf8').trim();
  if (password.length < 16) throw new Error(`${fileEnvName}_must_contain_at_least_16_characters`);
  return password;
}

async function upsertStagingUser(tx, { username, displayName, passwordHash, roleId }) {
  return tx.user.upsert({
    where: { username },
    update: {
      displayName,
      passwordHash,
      isActive: true,
      lastLoginAt: null,
      roles: {
        deleteMany: {},
        create: [{ roleId }],
      },
    },
    create: {
      username,
      displayName,
      passwordHash,
      isActive: true,
      roles: { create: [{ roleId }] },
    },
    select: { id: true, username: true, isActive: true },
  });
}

async function main() {
  const safety = assertRuntimeSafety();
  if (!safety.isStaging || safety.externalIntegrationsAllowed) throw new Error('staging_safety_contract_required');

  const expectedDatabase = required('STAGING_EXPECTED_DATABASE');
  const identityRows = await prisma.$queryRaw`
    SELECT current_database() AS database, current_user AS role,
           inet_server_addr()::text AS host, inet_server_port() AS port
  `;
  const identity = identityRows[0];
  if (identity?.database !== expectedDatabase) {
    throw new Error(`database_identity_mismatch_expected_${expectedDatabase}_actual_${identity?.database || 'unknown'}`);
  }

  const adminUsername = required('STAGING_ADMIN_USERNAME');
  const employeeUsername = required('STAGING_EMPLOYEE_USERNAME');
  const [adminPasswordHash, employeePasswordHash] = await Promise.all([
    hashPassword(readPassword('STAGING_ADMIN_PASSWORD_FILE')),
    hashPassword(readPassword('STAGING_EMPLOYEE_PASSWORD_FILE')),
  ]);

  const result = await prisma.$transaction(async (tx) => {
    const sessionsDeleted = await tx.userSession.deleteMany();
    const driveCredentialsDeleted = await tx.googleDriveCredential.deleteMany();
    const agentOperationsDeleted = await tx.agentOperation.deleteMany();
    const agentAccessLogsDeleted = await tx.agentAccessLog.deleteMany();
    const telegramLogsDeleted = await tx.telegramCronLog.deleteMany();

    await tx.settings.updateMany({
      data: {
        whatsappEnabled: false,
        whatsappNumber: null,
        whatsappGroupIds: [],
        telegramEnabled: false,
        telegramBotToken: null,
        telegramChatIds: [],
        telegramCronEnabled: false,
        telegramCronChatId: null,
        telegramCronMessage: null,
        telegramCronReminderEnabled: false,
        telegramCronReminderMessage: null,
        challanFromName: 'GLINTEX STAGING',
        challanFromAddress: 'EMPLOYEE TEST ENVIRONMENT',
        challanFromMobile: null,
      },
    });
    await tx.whatsappTemplate.updateMany({
      data: { enabled: false, sendToPrimary: false, groupIds: [], telegramChatIds: [] },
    });
    const customersSanitized = await tx.customer.updateMany({
      data: { phone: null, address: 'STAGING FIXTURE' },
    });
    const deliveryLogsSanitized = await tx.notificationDeliveryLog.updateMany({
      data: { recipient: null, error: null },
    });
    const documentMessagesSanitized = await tx.documentMessage.updateMany({
      data: { phone: 'REDACTED', caption: null },
    });
    await tx.user.updateMany({ data: { isActive: false, lastLoginAt: null } });

    const adminRole = await tx.role.upsert({
      where: { key: 'admin' },
      update: {},
      create: {
        key: 'admin',
        name: 'Administrator',
        description: 'System administrator',
        permissions: normalizePermissions({}, { baseDefault: ACCESS_LEVELS.WRITE, actionDefault: ACCESS_LEVELS.WRITE }),
      },
    });
    const employeeRole = await tx.role.upsert({
      where: { key: 'staging_employee' },
      update: {
        name: 'Staging Employee',
        description: 'Employee testing access for the isolated staging environment',
        permissions: normalizePermissions({}, { baseDefault: ACCESS_LEVELS.WRITE, actionDefault: ACCESS_LEVELS.WRITE }),
      },
      create: {
        key: 'staging_employee',
        name: 'Staging Employee',
        description: 'Employee testing access for the isolated staging environment',
        permissions: normalizePermissions({}, { baseDefault: ACCESS_LEVELS.WRITE, actionDefault: ACCESS_LEVELS.WRITE }),
      },
    });

    const admin = await upsertStagingUser(tx, {
      username: adminUsername,
      displayName: 'Staging Administrator',
      passwordHash: adminPasswordHash,
      roleId: adminRole.id,
    });
    const employee = await upsertStagingUser(tx, {
      username: employeeUsername,
      displayName: 'Employee Tester',
      passwordHash: employeePasswordHash,
      roleId: employeeRole.id,
    });

    return {
      sessionsDeleted: sessionsDeleted.count,
      driveCredentialsDeleted: driveCredentialsDeleted.count,
      agentOperationsDeleted: agentOperationsDeleted.count,
      agentAccessLogsDeleted: agentAccessLogsDeleted.count,
      telegramLogsDeleted: telegramLogsDeleted.count,
      customersSanitized: customersSanitized.count,
      deliveryLogsSanitized: deliveryLogsSanitized.count,
      documentMessagesSanitized: documentMessagesSanitized.count,
      accounts: [admin, employee],
    };
  });

  const counts = await Promise.all([
    prisma.packedUnit.count(),
    prisma.dispatchChallan.count(),
    prisma.packingBatch.count(),
    prisma.user.count({ where: { isActive: true } }),
    prisma.userSession.count(),
    prisma.googleDriveCredential.count(),
  ]);

  console.log(JSON.stringify({
    ok: true,
    identity,
    runtimeMode: safety.runtimeMode,
    externalIntegrationsDisabled: true,
    result,
    counts: {
      packedUnits: counts[0],
      dispatchChallans: counts[1],
      packingBatches: counts[2],
      activeUsers: counts[3],
      sessions: counts[4],
      googleDriveCredentials: counts[5],
    },
  }));
}

main()
  .catch((error) => {
    console.error(JSON.stringify({ ok: false, error: error?.message || String(error) }));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
