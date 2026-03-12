import { Worker } from "bullmq";
import { connection } from "./queue/job.queue"; // หรือ "./queue/voc.queue" ถ้าแยกไฟล์ connection ไว้
import { prisma } from "./lib/prisma";
//import { Prisma } from "@prisma/client";

// ✅ โหลด Endpoint จาก ENV (ถ้าไม่มีให้ใช้ Webhook.site สำหรับ Dev)
const WEBHOOK_URL = process.env.SOAP_ENDPOINT || "https://webhook.site/b45899da-8252-47ff-bb0a-b2f65ff66e85"; 

// ตัวแปรจำ ID งานที่กำลังทำอยู่ (เอาไว้คืนค่าตอนโดนปิดกะทันหัน)
let processingJobId: string | null = null;
const MIN_JOB_DURATION_MS = 5 * 60 * 1000; // Worker (Execution): หน่วงเวลา 5 นาที / 1 งาน (ถ้าต้องการให้รันไวตอนเทส ปรับเป็น 1000 ได้ครับ)

// กำหนด Status ตามที่ Database ใหม่ใช้
const VOC_1129_STATUS = {
  ERROR: "ERROR",
  IN_PROGRESS: "IN_PROGRESS",
  COMPLETE: "COMPLETE",
} as const;

export const startWorker = () => {
  console.log(`👷 Worker Service Started (SOAP Mode). Endpoint: ${WEBHOOK_URL}`);

  // ⚠️ ชื่อคิวต้องตรงกับที่ export ใน voc.queue.ts (ในที่นี้สมมติว่าเป็น "voc-queue" หรือ "job-queue")
  const worker = new Worker(
    "voc-queue", // <-- แก้ชื่อคิวตรงนี้ให้ตรงกับที่ตั้งไว้ใน src/queue/voc.queue.ts 
    async (job) => {
      const jobStartedAt = Date.now();
      
      // รับค่าที่ส่งมาจาก cron
      const vocMasterId = job.data.vocMasterId;
      const vocNo = job.data.vocNo;

      if (!vocMasterId) {
        console.error(`❌ [WORKER] Invalid Job Data: Missing vocMasterId`);
        return;
      }

      // 1. เช็คงานใน DB ว่ามีอยู่จริงไหม
      const existingJob = await prisma.voc_master.findUnique({
        where: { id: vocMasterId }
      });

      if (!existingJob) {
        console.warn(`👻 [WORKER] VOC ID ${vocMasterId} not found in DB. Skipping...`);
        return;
      }

      // เริ่มงานจริง
      processingJobId = vocMasterId; 
      console.log(`📥 [WORKER] Received VOC: ${vocNo} (Processing...)`);

      try {
        // 2. Query ดึงข้อมูลจริงจาก DB ตาม SQL Script ของพี่ๆ 
        const queryResult = await prisma.$queryRaw<any[]>(Prisma.sql`
          SELECT vm.voc_no,
                 vm2.cc_code,
                 CONCAT_WS(' > ', vm2.request_type_name, vm2.topic_name, vm2.issue_name, vm2.sub_issue_name) AS desc,
                 vm.status,
                 vs.cc_maping,
                 vt.detail,
                 vt.created_at
          FROM public.voc_master AS vm
          LEFT JOIN public.voc_detail AS vd ON vm.id = vd.voc_master_id 
          LEFT JOIN public.voc_mapping AS vm2 ON vm.request_type = vm2.request_type_id AND vm.topic = vm2.topic_id AND vm.issue = vm2.issue_id AND vm.sub_issue = vm2.sub_issue_id 
          LEFT JOIN public.voc_status AS vs ON vs.status_en = vm.status  
          LEFT JOIN (
              SELECT DISTINCT ON (voc_master_id) voc_master_id, detail, created_at
              FROM public.voc_tracking 
              ORDER BY voc_master_id, created_at DESC
          ) vt ON vt.voc_master_id = vm.id
          WHERE vm.id = ${vocMasterId};
        `);

        if (queryResult.length === 0) throw new Error("Data not found in view query");
        const payloadData = queryResult[0];

        // 3. สร้าง XML Body (SOAP Envelope) จากข้อมูลจริงที่ดึงมา
        const xmlBody = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <VocData>
      <VocNo>${payloadData.voc_no || ''}</VocNo>
      <CcCode>${payloadData.cc_code || ''}</CcCode>
      <Description>${payloadData.desc || ''}</Description>
      <Status>${payloadData.status || ''}</Status>
      <TrackingDetail>${payloadData.detail || ''}</TrackingDetail>
    </VocData>
  </soap:Body>
</soap:Envelope>`;

        console.log(`🚀 [WORKER] Sending SOAP Request for ${vocNo}...`);
        
        // 4. ยิงแบบ SOAP 
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

        // --- รอ Rate Limit (5 นาที) ---
        const remainingMs = MIN_JOB_DURATION_MS - (Date.now() - jobStartedAt);
        if (remainingMs > 0) {
          console.log(`🕒 [WORKER] Enforcing rate limit: waiting ${Math.ceil(remainingMs / 1000)}s before completing...`);
          await new Promise((resolve) => setTimeout(resolve, remainingMs));
        }

        // ✅ 5. จบงาน Update DB เป็น COMPLETE พร้อม stamp วันเวลา
        await prisma.voc_master.update({
          where: { id: vocMasterId },
          data: { 
            cronjob_1129_last_run_status: VOC_1129_STATUS.COMPLETE, 
            cronjob_1129_last_run_date: new Date() 
          }
        });
        console.log(`✅ [WORKER] VOC ${vocNo} Completed (SOAP Sent)`);

      } catch (error) {
        console.error(`❌ [WORKER] VOC ${vocNo} Failed:`, error);
        
        try {
            const remainingMs = MIN_JOB_DURATION_MS - (Date.now() - jobStartedAt);
            if (remainingMs > 0) {
              console.log(`🕒 [WORKER] Enforcing rate limit: waiting ${Math.ceil(remainingMs / 1000)}s before failing...`);
              await new Promise((resolve) => setTimeout(resolve, remainingMs));
            }

            // ❌ 6. พัง Update DB เป็น ERROR พร้อม stamp วันเวลา
            await prisma.voc_master.update({
                where: { id: vocMasterId }, 
                data: { 
                  cronjob_1129_last_run_status: VOC_1129_STATUS.ERROR, 
                  cronjob_1129_last_run_date: new Date() 
                }
            });
        } catch (dbError) {
             console.error("⚠️ Failed to update error status to DB");
        }
        
        throw error;
      } finally {
        processingJobId = null; // คืนค่าตัวแปร
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

  // 🛡️ Graceful Shutdown: ดักจับการกด Ctrl+C
  const gracefulShutdown = async () => {
    if (processingJobId) {
      console.log(`\n⚠️ Worker stopping! Resetting VOC ${processingJobId} back to ERROR...`);
      try {
        // ถ้าระบบโดนปิดกลางคัน ให้เซ็ตสถานะเป็น ERROR ไปเลย เพื่อให้ Cron ลูบหน้ากวาดไปทำใหม่
        await prisma.voc_master.update({
          where: { id: processingJobId },
          data: { 
            cronjob_1129_last_run_status: VOC_1129_STATUS.ERROR,
            cronjob_1129_last_run_date: new Date()
          }
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