export function calendarScheduleTime(slot: Date, daily: boolean, now: number): Date | null {
  const time = new Date(slot);
  if (!Number.isFinite(time.getTime())) return null;
  if (daily) {
    const end = new Date(slot);
    end.setHours(24, 0, 0, 0);
    if (end.getTime() <= now) return null;
    time.setHours(9, 0, 0, 0);
    if (time.getTime() <= now) time.setTime(Math.ceil((now + 60000) / 1800000) * 1800000);
    if (time >= end) return null;
  }
  return time.getTime() > now ? time : null;
}

export function isFutureSchedule(time: string, now: number): boolean {
  const value = new Date(time).getTime();
  return Number.isFinite(value) && value > now;
}
