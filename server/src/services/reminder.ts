import db from "../db";

interface PendingReminder {
  openid: string;
  name: string;
  dosage: string;
  times: string;
  template_id: string;
}

export function getPendingReminders(): PendingReminder[] {
  return db
    .query(
      `SELECT u.openid, m.name, m.dosage, m.times, s.template_id
       FROM medications m
       JOIN users u ON m.user_id = u.id
       JOIN subscriptions s ON s.user_id = u.id AND s.status = 'accept'
       WHERE m.status = 'active'
       AND json_extract(u.settings, '$.reminderEnabled') = 1`
    )
    .all() as PendingReminder[];
}
