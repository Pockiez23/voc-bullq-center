// src/queue/job.queue.ts
import { Queue } from "bullmq";
import IORedis from "ioredis";

// สร้าง Redis connection กลาง
export const connection = new IORedis({
  host: "127.0.0.1",
  port: 6379,
  maxRetriesPerRequest: null, 
});

// สร้าง Queue
export const jobQueue = new Queue("job-queue", {
  connection,
});
