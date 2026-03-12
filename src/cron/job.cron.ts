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
  console.log(
    `⏰ VOC 1129 Cron interval: every ${voc1129IntervalMinutes} minute(s) (${voc1129CronExpr})`
  );

  // Task: VOC 1129 dispatcher
  // - เฉพาะ voc_no ขึ้นต้นด้วย C
  // - เลือกเคสที่ยังไม่เคยส่ง หรือ updated หลังจาก run ล่าสุด
  // - รวมถึงสถานะ ERROR, IN_PROGRESS ให้วนส่งใหม่
  cron.schedule(voc1129CronExpr, async () => {
    try {
      const now = new Date();

      type VocToQueue = {
        id: string;
        voc_no: string;
      };

      const candidates = await prisma.$queryRaw<VocToQueue[]>(Prisma.sql`
        SELECT id, voc_no
        FROM public.voc_master
        WHERE voc_no LIKE 'C%'
          AND (
            cronjob_1129_last_run_date IS NULL
            OR cronjob_1129_last_run_date < updated_at
            OR cronjob_1129_last_run_status IN (${Prisma.join([
              VOC_1129_STATUS.ERROR,
              VOC_1129_STATUS.IN_PROGRESS,
            ])})
          );
      `);

      if (candidates.length === 0) {
        return;
      }

      console.log(
        `[VOC-1129] Found ${candidates.length} record(s) to enqueue (C*).`
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