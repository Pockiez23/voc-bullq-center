import { PrismaClient, JobStatus } from "@prisma/client";
import { jobQueue } from "./queue/job.queue";
import "./worker/job.worker";

const prisma = new PrismaClient();

console.log("👷 Worker auto-scanner started...");

// เช็คทุก 30 วินาที
setInterval(async () => {
  const pendingJob = await prisma.job.findFirst({
    where: {
      status: JobStatus.PENDING,
    },
    orderBy: {
      id: "asc",
    },
  });

  if (pendingJob) {
    console.log("🟡 Found pending job:", pendingJob.id);

    // เปลี่ยนเป็น RUNNING กันชนซ้ำ
    await prisma.job.update({
      where: { id: pendingJob.id },
      data: {
        status: JobStatus.RUNNING,
        is_run: true,
      },
    });

    // add เข้า queue
    await jobQueue.add("process-job", {
      jobId: pendingJob.id,
    });
  }
}, 5000);
