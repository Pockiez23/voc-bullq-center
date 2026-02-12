import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";

export const createJob = async (name: string) => {
  const job = await prisma.job.create({
    data: {
      name,
      status: "PENDING",
    },
  });

  return {
    message: "Job created",
    data: job,
  };
};

export const getJobById = async (id: number) => {
  return await prisma.job.findUnique({
    where: { id },
  });
};

export const startJob = async (id: number) => {
  const job = await prisma.job.findUnique({
    where: { id },
  });

  if (!job) {
    throw new Error("Job not found");
  }

  if (job.status !== "PENDING") {
    throw new Error("Job already started or completed");
  }

  // push เข้า Redis queue
  await redis.lpush(
    "job_queue",
    JSON.stringify({
      jobId: job.id,
      name: job.name,
    })
  );

  await prisma.job.update({
    where: { id },
    data: {
      status: "RUNNING",
    },
  });

  return {
    message: "Job started",
  };
};
