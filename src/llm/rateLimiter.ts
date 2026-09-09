/**
 * Resilient Rate Limiter with Token Bucket, Queueing, Exponential Backoff, and Jitter.
 * Prevents breaching Free-Tier RPM/TPM limits and safely recovers when receiving 429 Too Many Requests.
 */
export class RateLimiter {
  private queue: Array<() => Promise<void>> = [];
  private isProcessing = false;
  private minIntervalMs: number;
  private lastRequestTime = 0;

  constructor(maxRequestsPerMinute = 15) {
    // Leave margin: 15 req/min -> interval of ~4000ms
    this.minIntervalMs = Math.ceil(60000 / Math.max(1, maxRequestsPerMinute));
  }

  /**
   * Schedules an async task respecting the minimum interval and handling 429 retries.
   */
  async execute<T>(task: () => Promise<T>, maxRetries = 5): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push(async () => {
        let attempt = 0;
        while (attempt <= maxRetries) {
          try {
            // Throttle to avoid hitting RPM
            const now = Date.now();
            const timeSinceLast = now - this.lastRequestTime;
            if (timeSinceLast < this.minIntervalMs) {
              await this.sleep(this.minIntervalMs - timeSinceLast);
            }
            this.lastRequestTime = Date.now();

            const result = await task();
            resolve(result);
            return;
          } catch (err: any) {
            attempt++;
            const isRateLimit =
              err?.status === 429 ||
              err?.response?.status === 429 ||
              (err?.message && err.message.toLowerCase().includes('rate limit')) ||
              (err?.message && err.message.toLowerCase().includes('quota')) ||
              (err?.message && err.message.toLowerCase().includes('slow down')) ||
              (err?.message && err.message.toLowerCase().includes('resource has been exhausted'));

            if (isRateLimit && attempt <= maxRetries) {
              // Exponential backoff with random jitter: (2^attempt * 1500ms) + jitter
              const jitter = Math.floor(Math.random() * 1000);
              const delayMs = Math.pow(2, attempt) * 1500 + jitter;
              console.warn(`[RateLimiter] Rate limit hit (attempt ${attempt}/${maxRetries}). Backing off for ${delayMs}ms...`);
              await this.sleep(delayMs);
            } else if (attempt <= maxRetries && (err?.code === 'ECONNRESET' || err?.code === 'ETIMEDOUT')) {
              const delayMs = 2000 * attempt;
              console.warn(`[RateLimiter] Network blip ${err.code}. Retrying in ${delayMs}ms...`);
              await this.sleep(delayMs);
            } else {
              reject(err);
              return;
            }
          }
        }
      });

      this.processQueue();
    });
  }

  private async processQueue() {
    if (this.isProcessing || this.queue.length === 0) return;
    this.isProcessing = true;

    while (this.queue.length > 0) {
      const task = this.queue.shift();
      if (task) {
        try {
          await task();
        } catch {
          // Errors handled in individual execute promises
        }
      }
    }

    this.isProcessing = false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(res => setTimeout(res, ms));
  }
}
