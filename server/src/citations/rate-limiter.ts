export interface RateLimiter {
  acquire: (host: string) => Promise<void>;
}

export interface RateLimiterOptions {
  minIntervalMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_MIN_INTERVAL_MS = 1000;

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// Reference verification and topic retrieval both call api.openalex.org. A limiter only paces the hosts
// it has seen itself, so two independent instances double the real request rate against the same host
// and provoke the throttling both paths then have to absorb. Callers that do not need their own timing
// share this one.
let shared: RateLimiter | undefined;

export function sharedRateLimiter(): RateLimiter {
  if (shared === undefined) {
    shared = createRateLimiter();
  }
  return shared;
}

export function createRateLimiter(options: RateLimiterOptions = {}): RateLimiter {
  const minIntervalMs = options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const nextAllowed = new Map<string, number>();

  return {
    acquire: async (host: string): Promise<void> => {
      const current = now();
      const previous = nextAllowed.get(host) ?? 0;
      const start = Math.max(current, previous);
      nextAllowed.set(host, start + minIntervalMs);
      const waitMs = start - current;
      if (waitMs > 0) {
        await sleep(waitMs);
      }
    },
  };
}
