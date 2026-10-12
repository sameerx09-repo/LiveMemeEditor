export function getInstagramSchedulerCutoff(): string | null {
  const value = process.env.INSTAGRAM_SCHEDULER_NOT_BEFORE;
  if (!value) return null;
  const cutoff = new Date(value);
  if (!Number.isFinite(cutoff.getTime())) throw new Error("Invalid INSTAGRAM_SCHEDULER_NOT_BEFORE; publishing is blocked");
  return cutoff.toISOString();
}

export function getInstagramSchedulerBatchSize(): number {
  const value = process.env.INSTAGRAM_SCHEDULER_BATCH_SIZE;
  if (value === undefined || value === "") return process.env.VERCEL ? 10 : 5;
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 20) {
    throw new Error("INSTAGRAM_SCHEDULER_BATCH_SIZE must be a whole number from 1 to 20");
  }
  return Number(value);
}

export function getInstagramSchedulerStatus() {
  if (process.env.VERCEL) {
    const notBefore = getInstagramSchedulerCutoff();
    const enabled = process.env.VERCEL_ENV === "production" && !!notBefore &&
      ["external", "vercel"].includes(process.env.INSTAGRAM_SCHEDULER_MODE || "") &&
      !!(process.env.INSTAGRAM_CRON_SECRET || process.env.CRON_SECRET);
    return {
      enabled, mode: enabled ? process.env.INSTAGRAM_SCHEDULER_MODE : "disabled", notBefore,
      message: enabled ? "Production scheduler configured" : "Production scheduler is off. Configure a worker and future-only activation cutoff.",
    };
  }
  const local = process.env.INSTAGRAM_SCHEDULER_ENABLED === "true" && process.env.INSTAGRAM_SCHEDULER_MANAGED === "true" && !!process.env.INSTAGRAM_CRON_SECRET;
  const external = process.env.INSTAGRAM_SCHEDULER_MODE === "external" && !!process.env.INSTAGRAM_CRON_SECRET;
  return {
    enabled: local || external,
    mode: local ? "local" : external ? "external" : "disabled",
    notBefore: getInstagramSchedulerCutoff(),
    message: local ? "Scheduler enabled" : external ? "External scheduler configured" : "Scheduler is off. Scheduled posts will not publish.",
  };
}
