/**
 * Counting how many people use VB Notes, with nothing that tells them apart (Settings › About).
 * A device sends "used today" at most once a day, plus "first time this week" and "first time this
 * month" when they apply, each with only its platform and version. With no id, a day's count is
 * that day's users, and the week and month events count weekly and monthly users. The pings go to
 * our own Umami through `/api/count` on stats.appmox.com, which drops the sender's address and
 * user agent before Umami sees them. Shared by the phone and the desktop app.
 */

export const COUNT_URL = 'https://stats.appmox.com/api/count';
/** The "VB Notes app" site in Umami. */
const WEBSITE = 'a0acd74c-a993-4051-b127-1b8e7aeed285';

/** When this device was last counted: its local day, the Monday of that week, and the month. */
export interface Counted { day: string; week: string; month: string }

const EVENTS = [['month', 'monthly-user'], ['week', 'weekly-user'], ['day', 'daily-user']] as const;

const pad = (n: number) => String(n).padStart(2, '0');
const dayOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function periodsOf(now: Date): Counted {
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  return { day: dayOf(now), week: dayOf(monday), month: dayOf(now).slice(0, 7) };
}

/**
 * Sends the events that are due. `save` runs after each one that went, so a send that fails
 * (offline) is tried again next time without counting the others twice. `send` throws on failure.
 */
export async function countUse(last: Counted | null, platform: string, version: string, send: (body: string) => Promise<void>, save: (c: Counted) => unknown, now = new Date()) {
  const due = periodsOf(now);
  const done: Counted = { day: '', week: '', month: '', ...last };
  for (const [period, name] of EVENTS) {
    if (done[period] === due[period]) continue;
    await send(JSON.stringify({
      type: 'event',
      payload: { website: WEBSITE, hostname: 'app.vbnotes.com', url: `/${platform}`, name, data: { platform, version } },
    }));
    done[period] = due[period];
    await save({ ...done });
  }
}
