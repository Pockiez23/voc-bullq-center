import { Worker } from "bullmq";
import { connection } from "./queue/job.queue";
import { prisma } from "./lib/prisma";
import { JobStatus } from "@prisma/client";

// ⚠️ อย่าลืมแก้ URL ให้ตรงกับปัจจุบันของ Webhook.site ของคุณนะครับ
const WEBHOOK_URL = "https://webhook.site/f4303190-5549-41e1-8222-548094644681"; 

// ตัวแปรจำ ID งานที่กำลังทำอยู่ (เอาไว้คืนค่าตอนโดนปิดกะทันหัน)
let processingJobId: number | null = null;
const MIN_JOB_DURATION_MS = 5 * 60 * 1000; // Worker (Execution): ทำงาน 5 นาที / 1 งาน

export const startWorker = () => {
  console.log("👷 Worker Service Started (SOAP Mode). Waiting for jobs...");

  const worker = new Worker(
    "job-queue",
    async (job) => {
      const jobStartedAt = Date.now();
      // 1. แปลง ID ให้ชัวร์ (รองรับทั้ง id และ jobId กันพลาด)
      const rawId = job.data.id || job.data.jobId;
      const jobId = Number(rawId);

      if (!jobId || isNaN(jobId)) {
        console.error(`❌ [WORKER] Invalid Job ID: ${rawId}`);
        return;
      }

      // 2. เช็คงานใน DB ว่ามีอยู่จริงไหม (กันงานผี Ghost Job)
      const existingJob = await prisma.job.findUnique({
        where: { id: jobId }
      });

      if (!existingJob) {
        console.warn(`👻 [WORKER] Job ID ${jobId} not found in DB. Skipping...`);
        return;
      }

      // 3. เช็คสถานะ (กันทำซ้ำ Duplicate)
      if (existingJob.status === JobStatus.COMPLETED || existingJob.status === JobStatus.FAILED) {
        console.log(`⏭️ [WORKER] Job ${jobId} is already ${existingJob.status}. Skipping duplicate...`);
        return;
      }

      // เริ่มงานจริง
      processingJobId = jobId; 
      console.log(`📥 [WORKER] Received Job ID: ${jobId} (Processing...)`);

      try {
        // หน่วงเวลาจำลองการทำงาน (ปรับเลขได้ตามใจชอบครับ หน่วยเป็น ms)
        console.log(`⏳ [WORKER] Job ${jobId} is working...`);
        await new Promise((resolve) => setTimeout(resolve, 3000)); 

        // ✅ 4. สร้าง XML Body (SOAP Envelope)
        const xmlBody = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <ProcessJobRequest xmlns="http://tempuri.org/">
      <JobId>${jobId}</JobId>
      <Name>${job.data.name || 'Unknown'}</Name>
      <Timestamp>${new Date().toISOString()}</Timestamp>
      <Status>Processed</Status>
    </ProcessJobRequest>
  </soap:Body>
</soap:Envelope>`;

        // ✅ 5. ยิงแบบ SOAP (เปลี่ยน Content-Type เป็น text/xml)
        console.log(`🚀 [WORKER] Sending SOAP Request to ${WEBHOOK_URL}`);
        
        const response = await fetch(WEBHOOK_URL, {
            method: "POST",
            headers: { 
              "Content-Type": "text/xml; charset=utf-8",
            },
            body: xmlBody
        });

        if (!response.ok) {
            throw new Error(`SOAP request failed with status ${response.status}`);
        }

        const remainingMs = MIN_JOB_DURATION_MS - (Date.now() - jobStartedAt);
        if (remainingMs > 0) {
          console.log(
            `🕒 [WORKER] Enforcing rate limit: waiting ${Math.ceil(
              remainingMs / 1000
            )}s before completing Job ${jobId}...`
          );
          await new Promise((resolve) => setTimeout(resolve, remainingMs));
        }

        // จบงาน Update DB เป็น COMPLETED
        await prisma.job.update({
          where: { id: jobId },
          data: { status: JobStatus.COMPLETED, is_run: false }
        });
        console.log(`✅ [WORKER] Job ${jobId} Completed (SOAP Sent)`);

      } catch (error) {
        console.error(`❌ [WORKER] Job ${jobId} Failed:`, error);
        
        // Update DB เป็น FAILED (ใส่ try-catch กันเหนียวเผื่อ DB หลุด)
        try {
            const remainingMs = MIN_JOB_DURATION_MS - (Date.now() - jobStartedAt);
            if (remainingMs > 0) {
              console.log(
                `🕒 [WORKER] Enforcing rate limit: waiting ${Math.ceil(
                  remainingMs / 1000
                )}s before failing Job ${jobId}...`
              );
              await new Promise((resolve) => setTimeout(resolve, remainingMs));
            }

            await prisma.job.update({
                where: { id: jobId }, 
                data: { status: JobStatus.FAILED, is_run: false }
            });
        } catch (dbError) {
             console.error("⚠️ Failed to update error status to DB");
        }
        
        throw error;
      } finally {
        // ล้างค่า ID เมื่อจบงาน (เพื่อให้รู้ว่าตอนนี้ว่างแล้ว)
        processingJobId = null;
      }
    },
    { 
      connection, 
      concurrency: 1 
    }
  );

  worker.on('failed', (job, err) => {
    console.error(`Job ${job?.id} failed globally with error ${err.message}`);
  });

  // Graceful Shutdown: ดักจับการกด Ctrl+C
  const gracefulShutdown = async () => {
    if (processingJobId) {
      console.log(`\n⚠️ Worker stopping! Resetting Job ${processingJobId} back to PENDING...`);
      try {
        // รีเซ็ตงานที่ค้างมือกลับเป็น PENDING
        await prisma.job.update({
          where: { id: processingJobId },
          data: { status: JobStatus.PENDING, is_run: false }
        });
        console.log("✅ Reset complete.");
      } catch (err) {
        console.error("❌ Failed to reset job status:", err);
      }
    }
    console.log("👋 Bye!");
    process.exit(0);
  };

  process.on('SIGINT', gracefulShutdown);
  process.on('SIGTERM', gracefulShutdown);
};