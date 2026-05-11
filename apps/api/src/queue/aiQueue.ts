import Queue from "bull";
import dotenv from "dotenv";

dotenv.config();

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";

// Upstash uses TLS — rediss:// scheme requires explicit ioredis TLS config
function buildRedisOpts(url: string) {
  const isTls = url.startsWith("rediss://");
  if (!isTls) return url; // plain redis:// — pass as string, ioredis handles it

  // Parse rediss://default:<password>@host:port into ioredis options
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
    // AI jobs take 1–5 min; 30s default causes false stall detection → jobs double-processed
    lockDuration: 600_000,    // 10 minutes
    stalledInterval: 30_000,  // check for stalled jobs every 30s
    maxStalledCount: 1,       // re-queue once after stall, then give up
  },
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 10_000 },
    removeOnComplete: 200,
    removeOnFail: 500,
  },
} as any);
