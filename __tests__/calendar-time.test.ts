import { calendarMoveTime, calendarScheduleTime, isFutureSchedule } from "@/lib/calendar-time";

test("hourly and half-hour slots reject past starts, including the current slot", () => {
  const now = new Date(2026,9,11,10,15).getTime();
  expect(calendarScheduleTime(new Date(2026,9,11,10),false,now)).toBeNull();
  expect(calendarScheduleTime(new Date(2026,9,11,10,15),false,now)).toBeNull();
  expect(calendarScheduleTime(new Date(2026,9,11,10,30),false,now)?.getMinutes()).toBe(30);
});

test("moving between days preserves the post's local time", () => {
  const original = new Date(2026,9,15,16,30).toISOString();
  const moved = calendarMoveTime(original, new Date(2026,9,16), true, new Date(2026,9,12).getTime())!;
  expect(moved.getDate()).toBe(16);
  expect(moved.getHours()).toBe(16);
  expect(moved.getMinutes()).toBe(30);
});

test("hourly and half-hour moves use the chosen slot and never allow the past", () => {
  const now = new Date(2026,9,12,10,15).getTime();
  const original = new Date(2026,9,13,16,30).toISOString();
  expect(calendarMoveTime(original, new Date(2026,9,12,10), false, now)).toBeNull();
  expect(calendarMoveTime(original, new Date(2026,9,12,10,30), false, now)?.getMinutes()).toBe(30);
  expect(calendarMoveTime(new Date(2026,9,13,9).toISOString(), new Date(2026,9,12), true, now)).toBeNull();
  expect(calendarMoveTime("invalid", new Date(2026,9,13), true, now)).toBeNull();
  expect(calendarMoveTime(original, new Date("invalid"), false, now)).toBeNull();
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
