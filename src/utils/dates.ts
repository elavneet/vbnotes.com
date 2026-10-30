const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY = 86_400_000;

const startOfDay = (ms: number) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };

/** Short relative date: "Just now", "5 min", "9:41 AM", "Yesterday", "14 Jun", "3 Mar 2024". */
export function formatNoteDate(ms: number, now = Date.now()): string {
  const diff = now - ms;
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min`;
  const d = new Date(ms);
  const today = startOfDay(now);
  if (ms >= today) {
    const h = d.getHours();
    return `${((h + 11) % 12) + 1}:${d.getMinutes().toString().padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
  }
  if (ms >= today - DAY) return 'Yesterday';
  if (ms >= today - 6 * DAY) return DAYS[d.getDay()];
  if (d.getFullYear() === new Date(now).getFullYear()) return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** Bucket for the notes feed: Today, Yesterday, This week, then one per month. */
export function dateGroup(ms: number, now = Date.now()): string {
  const today = startOfDay(now);
  if (ms >= today) return 'Today';
  if (ms >= today - DAY) return 'Yesterday';
  if (ms >= today - 6 * DAY) return 'This week';
  const d = new Date(ms);
  return d.getFullYear() === new Date(now).getFullYear() ? MONTHS_LONG[d.getMonth()] : `${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`;
}
