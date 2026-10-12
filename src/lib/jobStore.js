import { config } from '../config/config.js';
import { redis } from './redis.js';

// Job state lives in Upstash Redis so any instance can answer /progress and /file
const jobKey = (jobId) => `job:${jobId}`;

export const jobStore = {
  async create(jobId, fields) {
    const key = jobKey(jobId);

    await redis.hset(key, { status: 'downloading', progress: 0, ...fields });
    // HSET on an existing hash keeps the TTL, so it only needs to be set once
    await redis.expire(key, config.jobs.ttlSeconds);
  },

  async update(jobId, fields) {
    await redis.hset(jobKey(jobId), fields);
  },

  async get(jobId) {
    const job = await redis.hgetall(jobKey(jobId));

    if (!job || Object.keys(job).length === 0) return null;

    return { ...job, progress: Number(job.progress) };
  }
};
