import { PrismaClient, JobStatus } from "@prisma/client";
import { jobQueue } from "./queue/job.queue";
import "./worker/job.worker";

const prisma = new PrismaClient();

console.log("👷 Worker auto-scanner started...");

// เช็คทุก 30 วินาที
const scanner = setInterval(async () => {
  // ถ้ามีงานที่กำลัง RUNNING อยู่ ให้ข้ามการค้นหา — ทำให้รันทีละงาน
  const runningJob = await prisma.job.findFirst({
    where: { status: JobStatus.RUNNING },
  });

  if (runningJob) {
    console.log("⏳ A job is still running, skipping scan.", runningJob.id);
    return;
  }

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

    // พยายามอัพเดตแบบเงื่อนไข (atomic) เฉพาะเมื่อสถานะยังเป็น PENDING
    const result = await prisma.job.updateMany({
      where: { id: pendingJob.id, status: JobStatus.PENDING },
      data: {
        status: JobStatus.RUNNING,
        is_run: true,
      },
    });

    // ถ้าไม่มีแถวที่ถูกอัพเดต แปลว่ามีผู้รับงานไปแล้ว ให้ข้าม
    if (result.count === 0) {
      console.log("🔁 Pending job already claimed, skipping:", pendingJob.id);
      return;
    }

    // add เข้า queue
    await jobQueue.add("process-job", {
      jobId: pendingJob.id,
    });
  }
}, 30000);

// Graceful shutdown: reset any RUNNING jobs back to PENDING
const shutdown = async (reason = "shutdown") => {
  try {
    console.log(`🛑 Worker shutting down (${reason}) - resetting RUNNING jobs to PENDING`);

    // หยุด scanner
    clearInterval(scanner);

    // เปลี่ยนสถานะ RUNNING ทั้งหมดกลับเป็น PENDING เพื่อให้ถูก re-queued / ถูก found อีกครั้ง
    const reset = await prisma.job.updateMany({
      where: { status: JobStatus.RUNNING },
      data: { status: JobStatus.PENDING, is_run: false },
    });

    console.log(`♻️ Reset ${reset.count} running job(s) to PENDING`);
  } catch (err) {
    console.error("Error during shutdown reset:", err);
  } finally {
    try {
      await prisma.$disconnect();
    } catch (e) {
      /* ignore */
    }
    process.exit(0);
  }
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
  shutdown("uncaughtException");
});
