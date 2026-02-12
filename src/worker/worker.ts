import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";

const startWorker = async () => {
  console.log("👷 Worker started...");

  while (true) {
    const data = await redis.brpop("job_queue", 0);

    const payload = JSON.parse(data[1]);
    const jobId = payload.jobId;

    console.log("⚙️ Processing job:", jobId);

    try {
      // 🛠 จำลองการทำงาน
      await new Promise((resolve) => setTimeout(resolve, 5000));

      await prisma.job.update({
        where: { id: jobId },
        data: {
          status: "COMPLETED",
        },
      });

      console.log("✅ Job completed:", jobId);
    } catch (error) {
      await prisma.job.update({
        where: { id: jobId },
        data: {
          status: "FAILED",
        },
      });

      console.log("❌ Job failed:", jobId);
    }
  }
};

startWorker();
