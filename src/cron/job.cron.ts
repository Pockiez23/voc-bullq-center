import cron from "node-cron";
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";

export const startCron = () => {
  cron.schedule("*/20 * * * * *", async () => {
    console.log("⏰ Checking running jobs...");

    const job = await prisma.job.findFirst({
      where: {
        status: "RUNNING",
        is_run: false,
      },
      orderBy: {
        id: "asc",
      },
    });

    if (!job) {
      console.log("No running jobs");
      return;
    }

    await redis.lpush(
      "job_queue",
      JSON.stringify({ jobId: job.id })
    );

    await prisma.job.update({
      where: { id: job.id },
      data: { queued: true },
    });

    console.log("🚀 Job queued:", job.id);
  });
};
