import { Elysia } from "elysia";
import { prisma } from "../lib/prisma";
import { jobQueue } from "../queue/job.queue";
import { JobStatus } from "@prisma/client";

export const jobRoute = new Elysia({ prefix: "/jobs" })

  .post("/", async ({ body }) => {
    const { name } = body as { name: string };

    const job = await prisma.job.create({
      data: {
        name,
        status: JobStatus.PENDING,
      },
    });

    return job;
  })

  .patch("/:id/start", async ({ params }) => {
    const id = Number(params.id);

    // update status เป็น RUNNING ก่อนเข้า queue
    await prisma.job.update({
      where: { id },
      data: {
        status: JobStatus.RUNNING,
        is_run: true,
      },
    });

    await jobQueue.add("process-job", {
      jobId: id,
    });

    return { message: "Job added to queue" };
  })

  .get("/:id", async ({ params }) => {
    return prisma.job.findUnique({
      where: { id: Number(params.id) },
    });
  });
