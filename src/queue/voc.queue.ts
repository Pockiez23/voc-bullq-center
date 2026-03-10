import { Queue } from "bullmq";
import { connection } from "./job.queue";

// Queue สำหรับงานส่ง VOC 1129
export const vocQueue = new Queue("voc-1129-queue", {
  connection,
});

