import Queue from "bull";
import dotenv from "dotenv";

dotenv.config();

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";

// Mirror of the API's buildRedisOpts — Upstash requires explicit ioredis TLS config
// for rediss:// URLs. Passing the URL as a plain string silently fails with TLS.
function buildRedisOpts(url: string) {
  const isTls = url.startsWith("rediss://");
  if (!isTls) return url;

  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port) || 6379,
    password: parsed.password || undefined,
    username: parsed.username || undefined,
    tls: {},
    enableReadyCheck: false,
    maxRetriesPerRequest: null,
  };
}

export const aiQueue = new Queue("ai-jobs", {
  redis: buildRedisOpts(redisUrl),
  settings: {
    lockDuration: 600_000,
    stalledInterval: 30_000,
    maxStalledCount: 1,
  },
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 10_000 },
    removeOnComplete: 200,
    removeOnFail: 500,
  },
} as any);
