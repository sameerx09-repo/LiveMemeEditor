// Meta can return numeric IDs larger than JavaScript's safe integer range.
export function parseInstagramJson(text: string) {
  return JSON.parse(text, (key: string, value: unknown, context?: { source?: string }) => {
    if ((key === "user_id" || key === "id") && typeof value === "number") {
      if (context?.source && /^\d+$/.test(context.source)) return context.source;
      if (Number.isSafeInteger(value) && value >= 0) return String(value);
      throw new Error("Instagram returned an account ID that could not be read safely");
    }
    return value;
  });
}
