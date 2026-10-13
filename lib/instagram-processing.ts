// Leave headroom for container creation, publishing and DB writes in a 300s function.
export const INSTAGRAM_PROCESSING_WAIT_MS = 210_000;
export const INSTAGRAM_PROCESSING_POLL_MS = 10_000;

export class InstagramProcessingTimeoutError extends Error {
  constructor(readonly creationId: string) {
    super("Instagram is still processing this video after 3.5 minutes. Publishing was not attempted; this post has not been automatically retried.");
    this.name = "InstagramProcessingTimeoutError";
  }
}
