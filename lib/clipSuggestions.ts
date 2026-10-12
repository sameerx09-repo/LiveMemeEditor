import type { TranscriptSegment, ClipSuggestion } from "./types";
import { scoreSegment } from "./utils";

export function generateSuggestions(segments: TranscriptSegment[]): ClipSuggestion[] {
  const suggestions: ClipSuggestion[] = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const duration = seg.end - seg.start;
    const pauseBefore = i > 0 ? seg.start - segments[i - 1].end : 0;

    const score = scoreSegment(seg.text, duration, pauseBefore);

    if (score >= 0.3) {
      let reason = "";
      if (seg.text.toLowerCase().match(/actually|honestly|truth/)) reason = "Strong opening hook";
      else if (seg.text.includes("?")) reason = "Question — often quotable";
      else if (pauseBefore >= 0.8) reason = "Follows a long pause — likely a key point";
      else if (duration >= 5 && duration <= 20) reason = "Good clip length";
      else reason = "High-value segment";

      suggestions.push({
        segmentId: seg.id,
        text: seg.text,
        start: seg.start,
        end: seg.end,
        score,
        reason,
      });
    }
  }

  // Sort by score desc, return top 10
  return suggestions.sort((a, b) => b.score - a.score).slice(0, 10);
}
