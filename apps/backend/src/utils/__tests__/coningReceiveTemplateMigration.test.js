import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const url = process.env.CONING_TEMPLATE_MIGRATION_TEST_URL;
const migration = readFileSync(new URL(
  '../../../prisma/migrations/20261017140000_add_coning_receive_template_shift/migration.sql',
  import.meta.url,
), 'utf8');
const shiftLine = '🕒 *Shift:* @shift';

function sqlLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function query(sql) {
  const result = spawnSync('psql', ['-X', '--no-password', '--set', 'ON_ERROR_STOP=1', '--quiet', '-At', '--dbname', url], {
    input: sql, encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim().split('\n').filter(Boolean);
}

function fixture(event, template, id = 1) {
  return {
    id, event, template, enabled: false, sendToPrimary: false,
    groupIds: ['custom-wa-group', 'second-group'], telegramChatIds: ['custom-tg-chat'],
    createdAt: '2026-02-01T10:00:00', updatedAt: '2026-09-16T13:02:00',
    createdByUserId: 'original-author', updatedByUserId: 'custom-editor',
  };
}

test('Coning Receive template migration preserves custom content and settings and is idempotent', {
  skip: !url && 'Set CONING_TEMPLATE_MIGRATION_TEST_URL to a disposable PostgreSQL database ending in _test',
}, async (t) => {
  assert.match(query('SELECT current_database();')[0], /_test$/, 'Only a disposable test database is allowed');
  const cases = [
    ['default layout', '*Coning Receive Confirmation*\n🏷️ *Barcode:* @barcode\n📅 *Date:* @date',
      `*Coning Receive Confirmation*\n🏷️ *Barcode:* @barcode\n${shiftLine}\n📅 *Date:* @date`],
    ['custom content', '*Our receive!*\n📦 Custom A*B & <tag> @itemName\nOur date: {{ date }}\nKeep footer.',
      `*Our receive!*\n📦 Custom A*B & <tag> @itemName\n${shiftLine}\nOur date: {{ date }}\nKeep footer.`],
    ['CRLF layout', '*Custom*\r\nDate: @date\r\nFooter\r\n',
      `*Custom*\r\n${shiftLine}\r\nDate: @date\r\nFooter\r\n`],
    ['date first', '@date\nFooter', `${shiftLine}\n@date\nFooter`],
    ['no date', '*Custom receive*\nKeep footer', `*Custom receive*\nKeep footer\n${shiftLine}`],
    ['trailing newline', '*Custom receive*\n', `*Custom receive*\n${shiftLine}`],
    ['empty template', '', shiftLine],
    ['existing @shift', 'Custom @shift\n📅 *Date:* @date', 'Custom @shift\n📅 *Date:* @date'],
    ['existing braces shift', 'Custom {{ shift }}\nDate: @date', 'Custom {{ shift }}\nDate: @date'],
    ['shift with Unicode suffix', '@shiftरात\nDate: @date', '@shiftरात\nDate: @date'],
    ['similar variables', '@shiftName {{ shiftNote }}\nDate: @date', `@shiftName {{ shiftNote }}\n${shiftLine}\nDate: @date`],
    ['dotted variables', '@shift.note\nCustom @date.note', `@shift.note\nCustom @date.note\n${shiftLine}`],
    ['different date key', 'Custom @dateTime', `Custom @dateTime\n${shiftLine}`],
    ['multiple dates', 'First @date\nSecond {{ date }}', `${shiftLine}\nFirst @date\nSecond {{ date }}`],
  ];
  for (const [label, before, expected] of cases) {
    await t.test(label, () => {
      const rows = [
        fixture('receive_from_coning_machine_created', before),
        { ...fixture('receive_from_holo_machine_created', 'Keep *all* other templates @date', 2), enabled: true, sendToPrimary: true },
      ];
      const snapshots = query(`
        BEGIN;
        CREATE TEMP TABLE "WhatsappTemplate" (
          "id" INTEGER PRIMARY KEY, "event" TEXT UNIQUE NOT NULL, "template" TEXT NOT NULL,
          "enabled" BOOLEAN NOT NULL, "sendToPrimary" BOOLEAN NOT NULL,
          "groupIds" TEXT[] NOT NULL, "telegramChatIds" TEXT[] NOT NULL,
          "createdAt" TIMESTAMP NOT NULL, "updatedAt" TIMESTAMP NOT NULL,
          "createdByUserId" TEXT, "updatedByUserId" TEXT
        );
        INSERT INTO "WhatsappTemplate"
          SELECT * FROM json_populate_recordset(NULL::"WhatsappTemplate", ${sqlLiteral(JSON.stringify(rows))}::json);
        SELECT jsonb_agg(t ORDER BY id) FROM "WhatsappTemplate" t;
        ${migration}
        SELECT jsonb_agg(t ORDER BY id) FROM "WhatsappTemplate" t;
        ${migration}
        SELECT jsonb_agg(t ORDER BY id) FROM "WhatsappTemplate" t;
        ROLLBACK;
      `).map((line) => JSON.parse(line));
      assert.equal(snapshots.length, 3);
      const [original, once, twice] = snapshots;
      assert.deepEqual(once, [{ ...original[0], template: expected }, original[1]],
        'only the target template text may change');
      assert.deepEqual(twice, once, 'applying the migration twice must change nothing further');
    });
  }
  await t.test('missing target stays missing', () => {
    const result = query(`
      BEGIN;
      CREATE TEMP TABLE "WhatsappTemplate" ("id" INTEGER, "event" TEXT, "template" TEXT);
      ${migration}
      SELECT count(*) FROM "WhatsappTemplate";
      ROLLBACK;
    `);
    assert.deepEqual(result, ['0']);
  });
});
