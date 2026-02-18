import cron from "node-cron";
import { prisma } from "../lib/prisma";
import { jobQueue } from "../queue/job.queue";
import { JobStatus } from "@prisma/client";

export const startCron = () => {
  console.log("⏰ Cronjob Service Started...");

  // ✅ Task 1: ระบบ "รอให้เสร็จก่อนค่อยจ่ายงานใหม่"
  // เช็คทุกๆ 5 วินาที (เพื่อให้งานต่อเนื่องไวขึ้นเมื่อ Worker ว่าง)
  cron.schedule("*/30 * * * * *", async () => {
    try {
      //เช็คก่อนว่ามีงานที่กำลังวิ่งอยู่ไหม (RUNNING)
      const runningCount = await prisma.job.count({
        where: { status: JobStatus.RUNNING }
      });

      // ถ้ามีงานวิ่งอยู่ (แม้แต่งานเดียว) ให้หยุด ไม่ต้องส่งเพิ่ม
      if (runningCount > 0) {
        // console.log(`[CENTER] ⏳ Worker is busy (${runningCount} running). Waiting...`);
        return; 
      }

      //ถ้า Worker ว่าง (runningCount === 0) ให้หยิบงานใหม่มา "ทีละ 1 งาน"
      const jobs = await prisma.job.findMany({
        where: { status: JobStatus.PENDING },
        take: 1, // เอามาแค่ 1 เดียวเท่านั้น
        orderBy: { id: 'asc' }
      });

      if (jobs.length > 0) {
        const job = jobs[0]; // หยิบงานแรก
        console.log(`[CENTER] ✅ Worker is free. Pushing Job ID ${job.id} to Redis`);

        await jobQueue.add("process-job", {
          id: job.id,
          name: job.name,
          payload: {}
        });

        // Update เป็น RUNNING เพื่อบล็อกไม่ให้ Cron รอบหน้าส่งงานซ้อน
        await prisma.job.update({
          where: { id: job.id },
          data: { status: JobStatus.RUNNING, is_run: true },
        });
      } 
      // else { console.log("[CENTER] No pending jobs."); }

    } catch (error) {
      console.error("[CENTER] Error processing job:", error);
    }
  });

  // Task 2: ระบบกู้ชีพ (Rescue Stuck Jobs)
  // เหมือนเดิม: ถ้า RUNNING ค้างนานเกิน 1 นาที ให้รีเซ็ตกลับมาทำใหม่
  cron.schedule("*/30 * * * * *", async () => {
    // console.log("♻️ Checking for stuck jobs...");
    const oneMinuteAgo = new Date(Date.now() - 1 * 60 * 1000);

    const stuckJobs = await prisma.job.findMany({
      where: {
        status: JobStatus.RUNNING,
        updatedAt: { lt: oneMinuteAgo }
      }
    });

    if (stuckJobs.length > 0) {
       console.log(`[CENTER] 🚨 Found ${stuckJobs.length} stuck jobs (Worker might be dead). Re-queueing...`);
       for (const job of stuckJobs) {
          // โยนเข้า Queue ใหม่
          await jobQueue.add("process-job", {
            id: job.id,
            name: job.name,
            retry: true
          });
          
          // อัปเดตเวลา เพื่อให้ Cron Task 1 เห็นว่าเป็น RUNNING ต่อไป (แต่ Worker จะได้รับ msg ใหม่)
          await prisma.job.update({
            where: { id: job.id },
            data: { updatedAt: new Date() }
          });
       }
    }
  });
};