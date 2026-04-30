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

export const aiQueue = new Queue("ai-jobs", { redis: buildRedisOpts(redisUrl) } as any);
