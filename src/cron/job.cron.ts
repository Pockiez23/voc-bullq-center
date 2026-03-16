import cron from "node-cron";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { vocQueue } from "../queue/voc.queue";

const VOC_1129_STATUS = {
  ERROR: "ERROR",
  IN_PROGRESS: "IN_PROGRESS",
  COMPLETE: "COMPLETE",
} as const;

export type Voc1129Status =
  (typeof VOC_1129_STATUS)[keyof typeof VOC_1129_STATUS];

export const startCron = () => {
  console.log("⏰ Cronjob Service Started...");
  
  const voc1129IntervalMinutes = Number(
    process.env.VOC_1129_CRON_INTERVAL_MINUTES ?? "1"
  );
  const voc1129CronExpr = `*/${voc1129IntervalMinutes} * * * *`;
  
  const batchSizeEnv = parseInt(process.env.BATCH_SIZE || "10", 10);
  const maxQueueSize = isNaN(batchSizeEnv) ? 10 : batchSizeEnv;

  console.log(
    `⏰ VOC 1129 Cron interval: every ${voc1129IntervalMinutes} minute(s) | Max Queue Size: ${maxQueueSize}`
  );

  cron.schedule(voc1129CronExpr, async () => {
    try {
      // ป้องกันคิวล้น! เช็คก่อนว่าใน Redis มีงานค้างอยู่กี่งาน
      const waitingCount = await vocQueue.getWaitingCount();
      const activeCount = await vocQueue.getActiveCount();
      const totalInQueue = waitingCount + activeCount;

      // ถ้าคิวใน Redis เต็มโควต้าแล้ว ให้ข้ามรอบนี้ไปเลย รอ Worker ทำงานให้เสร็จก่อน
      if (totalInQueue >= maxQueueSize) {
        console.log(`⏳ [VOC-1129] Queue is full (${totalInQueue}/${maxQueueSize}). Waiting for Worker to clear...`);
        return; 
      }

      // คำนวณโควต้าที่ยังดึงเพิ่มได้ 
      const availableSlots = maxQueueSize - totalInQueue;
      const now = new Date();

      type VocToQueue = {
        id: string;
        voc_no: string;
      };
      
      // 3. ปรับเวลาเป็น 1 นาที เพื่อแก้ปัญหา Database กับ Server เวลาเหลื่อมกัน
      const candidates = await prisma.$queryRaw<VocToQueue[]>(Prisma.sql`
        SELECT id, voc_no
        FROM public.voc_master
        WHERE voc_no LIKE 'C%'
          AND (
            cronjob_1129_last_run_date IS NULL
            OR cronjob_1129_last_run_date < (updated_at - INTERVAL '1 minute')
            OR cronjob_1129_last_run_status = ${VOC_1129_STATUS.ERROR}
            OR (cronjob_1129_last_run_status = ${VOC_1129_STATUS.IN_PROGRESS} AND cronjob_1129_last_run_date < NOW() - INTERVAL '1 hour')
          )
        ORDER BY updated_at ASC, voc_no ASC
        LIMIT ${Prisma.raw(availableSlots.toString())};
      `);

      if (candidates.length === 0) {
        return;
      }

      console.log(
        `[VOC-1129] Adding ${candidates.length} new record(s) to queue. (Current active/waiting in queue: ${totalInQueue})`
      );

      for (const row of candidates) {
        await vocQueue.add("voc-1129-send", {
          vocMasterId: row.id,
          vocNo: row.voc_no,
        });

        await prisma.voc_master.update({
          where: { id: row.id },
          data: {
            cronjob_1129_last_run_status: VOC_1129_STATUS.IN_PROGRESS,
            cronjob_1129_last_run_date: now,
          },
        });
      }
    } catch (error) {
      console.error("[VOC-1129] Error in dispatcher cron:", error);
    }
  });
};