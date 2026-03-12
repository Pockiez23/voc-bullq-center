import { Elysia } from "elysia";
import { startCron } from "./cron/job.cron";
import { startWorker } from "./worker"; 

const mode = process.argv[2] || "center"; // รับค่าจาก command line

console.log(`🚀 Starting Service in mode: [${mode.toUpperCase()}]`);

if (mode === "center") {
  // --- CENTER MODE ---
  // 1. รัน Web Server 
  const app = new Elysia().listen(3000);
  
  console.log(`🌐 Center API running at ${app.server?.hostname}:${app.server?.port}`);

  // 2. รัน Cronjob สำหรับกวาดงาน VOC ลง Queue
  startCron();

} else if (mode === "worker") {
  // --- WORKER MODE ---
  startWorker();
} else {
  console.error("❌ Invalid mode. Use 'center' or 'worker'");
  process.exit(1);
}