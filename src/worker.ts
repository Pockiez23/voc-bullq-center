import { Worker } from "bullmq";
import { connection } from "./queue/job.queue";
import { prisma } from "./lib/prisma";
import { JobStatus } from "@prisma/client";

const WEBHOOK_URL = "https://webhook.site/f74f2b6c-3a40-494e-b3cf-7a6647c225d0"; 

let processingJobId: number | null = null;


export const startWorker = () => {
  console.log("👷 Worker Service Started. Waiting for jobs...");

  const worker = new Worker(
    "job-queue",
    async (job) => {
      const rawId = job.data.id || job.data.jobId;
      const jobId = Number(rawId);

      if (!jobId || isNaN(jobId)) return;

      // เช็คก่อนเลยว่า งานนี้ยังมีใน DB ไหม? 
      const existingJob = await prisma.job.findUnique({
        where: { id: jobId }
      });

      if (!existingJob) {
        console.warn(`👻 [WORKER] Job ID ${jobId} not found in DB (Stale job). Skipping...`);
        return; // จบฟังก์ชันเลย (ถือว่างานเสร็จแล้ว ให้ BullMQ ลบออกจากคิวไป)
      }

      // เริ่มงานจริง
      processingJobId = jobId; 
      console.log(`📥 [WORKER] Received Job ID: ${jobId} (Processing...)`);

      try {
        console.log(`⏳ [WORKER] Job ${jobId} is working...`);
        
        await new Promise((resolve) => setTimeout(resolve, 30000));

        // ยิง Webhook
        const body = {
          id: jobId,
          name: job.data.name,
          timestamp: new Date().toISOString(),
          extra: job.data.payload
        };

        const response = await fetch(WEBHOOK_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });

        // จบงาน Update DB
        // (ถึงตรงนี้มั่นใจได้ว่า update ผ่านแน่นอน เพราะเราเช็ค existingJob มาแล้ว)
        await prisma.job.update({
          where: { id: jobId },
          data: { 
            status: response.ok ? JobStatus.COMPLETED : JobStatus.FAILED, 
            is_run: false 
          }
        });

        console.log(`✅ [WORKER] Job ${jobId} Completed`);

      } catch (error) {
        console.error(`❌ [WORKER] Job ${jobId} Failed:`, error);
        
        // ต้อง try-catch ตรงนี้ซ้อนอีกที กัน error กรณี DB หายระหว่างทาง
        try {
            await prisma.job.update({
                where: { id: jobId }, 
                data: { status: JobStatus.FAILED, is_run: false }
            });
        } catch (dbError) {
            console.error("⚠️ Failed to update error status to DB (Record might be gone)");
        }
        
        throw error;
      } finally {
        processingJobId = null;
      }
    },
    { connection, concurrency: 1 }
  );

  // ... (ส่วน Graceful Shutdown เหมือนเดิม) ...
  const gracefulShutdown = async () => {
    if (processingJobId) {
        try {
            // เช็คก่อน update กันเหนียว
            const exists = await prisma.job.findUnique({ where: { id: processingJobId }});
            if (exists) {
                console.log(`\n⚠️ Worker stopping! Resetting Job ${processingJobId}...`);
                await prisma.job.update({
                    where: { id: processingJobId },
                    data: { status: JobStatus.PENDING, is_run: false }
                });
            }
        } catch (err) {
            console.error("❌ Failed to reset job status");
        }
    }
    process.exit(0);
  };
  
  process.on('SIGINT', gracefulShutdown);
  process.on('SIGTERM', gracefulShutdown);
};