import cron from 'node-cron';
import prisma from '../lib/prisma.js';
import telegram from '../../telegram/service.js';

let primaryCronTask = null;
let reminderCronTask = null;
let currentCronSchedule = null;
let currentReminderTime = null;
const TIMEZONE = 'Asia/Kolkata';

export function getTodayStringInTimeZone(timezone = 'Asia/Kolkata') {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
  return formatter.format(now); // returns YYYY-MM-DD
}

function buildReminderCronSchedule(primaryCron, reminderTime) {
  if (!primaryCron || !reminderTime) return null;
  const parts = primaryCron.trim().split(/\s+/);
  if (parts.length !== 5 && parts.length !== 6) return null;

  const timeParts = reminderTime.split(':');
  if (timeParts.length !== 2) return null;
  const hour = parseInt(timeParts[0], 10);
  const minute = parseInt(timeParts[1], 10);
  if (isNaN(hour) || isNaN(minute)) return null;

  if (parts.length === 5) {
    parts[0] = String(minute);
    parts[1] = String(hour);
  } else {
    // 6 fields: seconds, minutes, hours, day of month, month, day of week
    parts[0] = '0'; // force 0 seconds
    parts[1] = String(minute);
    parts[2] = String(hour);
  }
  return parts.join(' ');
}

export async function runPrimarySequence() {
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  if (!settings || !settings.telegramEnabled || !settings.telegramCronEnabled) {
    console.log('[TelegramCron] Primary sequence skipped (telegram or cron disabled)');
    return { skipped: true, reason: 'disabled' };
  }

  const chatId = settings.telegramCronChatId;
  const message = settings.telegramCronMessage;
  if (!chatId || !message) {
    console.warn('[TelegramCron] Primary sequence skipped (chat ID or message missing)');
    return { skipped: true, reason: 'missing_config' };
  }

  const todayStr = getTodayStringInTimeZone(TIMEZONE);
  console.log(`[TelegramCron] Sending primary message for ${todayStr} to ${chatId}...`);
  try {
    const result = await telegram.sendTextSafe(chatId, message);
    const messageId = result?.message_id || null;

    // Save to database
    await prisma.telegramCronLog.upsert({
      where: { date: todayStr },
      update: {
        initialSentAt: new Date(),
        initialMessageId: messageId,
        reminderSentAt: null,
        responseDetected: false,
        responseText: null,
        responseUser: null,
      },
      create: {
        date: todayStr,
        initialSentAt: new Date(),
        initialMessageId: messageId,
      }
    });
    console.log(`[TelegramCron] Primary message sent successfully, messageId: ${messageId}`);
    return { success: true, messageId };
  } catch (err) {
    console.error('[TelegramCron] Failed to send primary message:', err.message || err);
    await prisma.telegramCronLog.upsert({
      where: { date: todayStr },
      update: {
        responseText: `Failed to send primary: ${err.message || String(err)}`,
      },
      create: {
        date: todayStr,
        responseText: `Failed to send primary: ${err.message || String(err)}`,
      }
    });
    throw err;
  }
}

export async function runReminderSequence() {
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  if (!settings || !settings.telegramEnabled || !settings.telegramCronEnabled || !settings.telegramCronReminderEnabled) {
    console.log('[TelegramCron] Reminder check skipped (disabled in settings)');
    return { skipped: true, reason: 'disabled' };
  }

  const chatId = settings.telegramCronChatId;
  const reminderMessage = settings.telegramCronReminderMessage;
  if (!chatId || !reminderMessage) {
    console.warn('[TelegramCron] Reminder check skipped (chat ID or reminder message missing)');
    return { skipped: true, reason: 'missing_config' };
  }

  const todayStr = getTodayStringInTimeZone(TIMEZONE);
  const log = await prisma.telegramCronLog.findUnique({ where: { date: todayStr } });

  let sentAt = log?.initialSentAt;
  if (!sentAt) {
    console.log('[TelegramCron] Primary message was not recorded sent today. Using start of day as threshold.');
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    sentAt = startOfToday;
  }

  const initialSentEpoch = Math.floor(new Date(sentAt).getTime() / 1000);
  console.log(`[TelegramCron] Checking response in ${chatId} since ${new Date(sentAt).toISOString()}...`);

  try {
    const updates = await telegram.getUpdates({ limit: 100 }).catch(err => {
      console.error('[TelegramCron] Failed to fetch updates:', err.message);
      return [];
    });

    let responseDetected = false;
    let responseText = null;
    let responseUser = null;

    const matchingUpdate = (updates || []).find(upd => {
      const msg = upd.message || upd.channel_post;
      if (!msg) return false;

      const msgChatId = String(msg.chat?.id || '').trim();
      const targetChatId = String(chatId).trim();
      if (msgChatId !== targetChatId) return false;

      const msgDate = msg.date; // Unix timestamp
      if (msgDate <= initialSentEpoch) return false;

      // Ignore bot messages
      if (msg.from?.is_bot === true) return false;

      return true;
    });

    if (matchingUpdate) {
      const msg = matchingUpdate.message || matchingUpdate.channel_post;
      responseDetected = true;
      responseText = msg.text || '(media/other)';
      responseUser = msg.from
        ? `${msg.from.first_name || ''} ${msg.from.last_name || ''} (@${msg.from.username || ''})`.trim()
        : 'Unknown User';

      console.log(`[TelegramCron] Response detected from ${responseUser}: "${responseText}". Skipping reminder.`);

      await prisma.telegramCronLog.upsert({
        where: { date: todayStr },
        update: {
          responseDetected: true,
          responseText,
          responseUser,
        },
        create: {
          date: todayStr,
          responseDetected: true,
          responseText,
          responseUser,
        }
      });

      return { responseDetected: true, responseUser, responseText };
    }

    console.log(`[TelegramCron] No response detected. Sending reminder message to ${chatId}...`);
    const reminderResult = await telegram.sendTextSafe(chatId, reminderMessage);

    await prisma.telegramCronLog.upsert({
      where: { date: todayStr },
      update: {
        reminderSentAt: new Date(),
      },
      create: {
        date: todayStr,
        reminderSentAt: new Date(),
      }
    });

    return { responseDetected: false, reminderSent: true, messageId: reminderResult?.message_id || null };
  } catch (err) {
    console.error('[TelegramCron] Failed running reminder check sequence:', err.message || err);
    await prisma.telegramCronLog.upsert({
      where: { date: todayStr },
      update: {
        responseText: `Failed reminder check: ${err.message || String(err)}`,
      },
      create: {
        date: todayStr,
        responseText: `Failed reminder check: ${err.message || String(err)}`,
      }
    });
    throw err;
  }
}

export async function initTelegramCronScheduler() {
  try {
    const settings = await prisma.settings.findUnique({ where: { id: 1 } });
    if (settings) {
      applyTelegramCronSchedule(settings);
    }
  } catch (err) {
    console.error('[TelegramCron] Failed to initialize scheduler:', err.message);
  }
}

export function applyTelegramCronSchedule(settings) {
  if (primaryCronTask) {
    primaryCronTask.stop();
    primaryCronTask = null;
  }
  if (reminderCronTask) {
    reminderCronTask.stop();
    reminderCronTask = null;
  }

  if (!settings.telegramEnabled || !settings.telegramCronEnabled) {
    console.log('[TelegramCron] Scheduler disabled (telegram or cron disabled)');
    return;
  }

  const schedule = settings.telegramCronSchedule || '30 10 * * 4,6';
  const reminderTime = settings.telegramCronReminderTime || '14:00';

  if (!cron.validate(schedule)) {
    console.error(`[TelegramCron] Invalid primary schedule cron expression: "${schedule}"`);
    return;
  }

  primaryCronTask = cron.schedule(schedule, async () => {
    console.log('[TelegramCron] Triggering primary cron job...');
    try {
      await runPrimarySequence();
    } catch (err) {
      console.error('[TelegramCron] Error in primary cron job execution:', err.message);
    }
  }, {
    scheduled: true,
    timezone: TIMEZONE,
  });

  if (settings.telegramCronReminderEnabled) {
    const reminderSchedule = buildReminderCronSchedule(schedule, reminderTime);
    if (reminderSchedule && cron.validate(reminderSchedule)) {
      reminderCronTask = cron.schedule(reminderSchedule, async () => {
        console.log('[TelegramCron] Triggering reminder cron job...');
        try {
          await runReminderSequence();
        } catch (err) {
          console.error('[TelegramCron] Error in reminder cron job execution:', err.message);
        }
      }, {
        scheduled: true,
        timezone: TIMEZONE,
      });
      console.log(`[TelegramCron] Reminder job scheduled: "${reminderSchedule}" (At ${reminderTime} on target days)`);
    } else {
      console.error(`[TelegramCron] Could not build or validate reminder cron schedule from "${schedule}" and "${reminderTime}"`);
    }
  }

  currentCronSchedule = schedule;
  currentReminderTime = reminderTime;
  console.log(`[TelegramCron] Scheduler applied - Primary job schedule: "${schedule}"`);
}
