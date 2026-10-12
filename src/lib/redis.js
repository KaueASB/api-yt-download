import { Redis } from '@upstash/redis';

import { config } from '../config/config.js';

// Shared Upstash client (REST over HTTP, so any instance can use it without a connection pool)
export const redis = new Redis({
  url: config.redis.url,
  token: config.redis.token
});
