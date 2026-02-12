// src/worker/job.worker.ts
import { Worker } from "bullmq";
import { connection } from "../queue/job.queue";
import { PrismaClient, JobStatus } from "@prisma/client";

const prisma = new PrismaClient();

const worker = new Worker(
  "job-queue",
  async (job) => {
    console.log("📦 Processing job:", job.id);

    const { jobId } = job.data;

    try {
      // จำลองงาน
      await new Promise((resolve) => setTimeout(resolve, 3000));

      await prisma.job.update({
        where: { id: jobId },
        data: {
          status: JobStatus.COMPLETED,
          is_run: false,
        },
      });

      console.log("✅ Job completed:", job.id);
    } catch (error) {
      await prisma.job.update({
        where: { id: jobId },
        data: {
          status: JobStatus.FAILED,
          is_run: false,
        },
      });

      throw error;
    }
  },
  {
    connection,
  }
);

worker.on("completed", (job) => {
  console.log(`🎉 Completed job ${job.id}`);
});

worker.on("failed", (job, err) => {
  console.error(`❌ Failed job ${job?.id}`, err);
});

