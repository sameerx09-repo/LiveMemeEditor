import { calendarScheduleTime, isFutureSchedule } from "@/lib/calendar-time";

test("hourly and half-hour slots reject past starts, including the current slot", () => {
  const now = new Date(2026,9,11,10,15).getTime();
  expect(calendarScheduleTime(new Date(2026,9,11,10),false,now)).toBeNull();
  expect(calendarScheduleTime(new Date(2026,9,11,10,15),false,now)).toBeNull();
  expect(calendarScheduleTime(new Date(2026,9,11,10,30),false,now)?.getMinutes()).toBe(30);
});

test("day view rejects past days and suggests a future time for today", () => {
  const now = new Date(2026,9,11,16,20).getTime();
  expect(calendarScheduleTime(new Date(2026,9,10),true,now)).toBeNull();
  const today = calendarScheduleTime(new Date(2026,9,11),true,now)!;
  expect(today.getTime()).toBeGreaterThan(now);
  expect(today.getHours()).toBe(16);
  expect(today.getMinutes()).toBe(30);
  expect(calendarScheduleTime(new Date(2026,9,12),true,now)?.getHours()).toBe(9);
});

test("day view does not move a near-midnight choice into another date", () => {
  expect(calendarScheduleTime(new Date(2026,9,11),true,new Date(2026,9,11,23,59).getTime())).toBeNull();
});

test("confirmation requires a valid strictly future timestamp", () => {
  const now = new Date(2026,9,11,10,15).getTime();
  expect(isFutureSchedule("",now)).toBe(false);
  expect(isFutureSchedule("invalid",now)).toBe(false);
  expect(isFutureSchedule(new Date(now).toISOString(),now)).toBe(false);
  expect(isFutureSchedule(new Date(now-60000).toISOString(),now)).toBe(false);
  expect(isFutureSchedule(new Date(now+60000).toISOString(),now)).toBe(true);
});
