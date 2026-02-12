import { Worker } from "bullmq";
import { connection } from "../queue/job.queue";
import { PrismaClient, JobStatus } from "@prisma/client";

const prisma = new PrismaClient();

const worker = new Worker(
  "job-queue",
  async (job) => {
    const { jobId } = job.data;

    console.log("🔵 Processing job:", jobId);

    try {
      // จำลองทำงาน
      await new Promise((resolve) => setTimeout(resolve, 3000));

      await prisma.job.update({
        where: { id: jobId },
        data: {
          status: JobStatus.COMPLETED,
          is_run: false,
        },
      });

      console.log("✅ Completed:", jobId);
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
  { connection }
);

console.log("🚀 Job processor running...");
