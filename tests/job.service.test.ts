import { describe, it, expect, beforeEach, mock } from "bun:test";

const prismaMock = {
  job: {
    create: mock(async (args: any) => ({
      id: 1,
      name: args.data.name,
      status: "PENDING",
    })),
    findUnique: mock(async (_args: any) => null),
    update: mock(async (args: any) => ({
      id: args.where.id,
      ...args.data,
    })),
  },
};

const redisMock = {
  lpush: mock(async () => 1),
};

mock.module("../src/lib/prisma", () => ({
  prisma: prismaMock as any,
}));

mock.module("../src/lib/redis", () => ({
  redis: redisMock as any,
}));

import { createJob, getJobById, startJob } from "../src/service/job.service";

describe("job.service", () => {
  beforeEach(() => {
    prismaMock.job.create.mockClear();
    prismaMock.job.findUnique.mockClear();
    prismaMock.job.update.mockClear();
    redisMock.lpush.mockClear();
  });

  it("createJob should create job with PENDING status and return message + data", async () => {
    const result = await createJob("test-job");

    expect(prismaMock.job.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.job.create).toHaveBeenCalledWith({
      data: {
        name: "test-job",
        status: "PENDING",
      },
    });

    expect(result.message).toBe("Job created");
    expect(result.data).toEqual({
      id: 1,
      name: "test-job",
      status: "PENDING",
    });
  });

  it("getJobById should call prisma.findUnique with correct id", async () => {
    prismaMock.job.findUnique.mockResolvedValueOnce({
      id: 1,
      name: "test-job",
      status: "PENDING",
    });

    const job = await getJobById(1);

    expect(prismaMock.job.findUnique).toHaveBeenCalledTimes(1);
    expect(prismaMock.job.findUnique).toHaveBeenCalledWith({
      where: { id: 1 },
    });
    expect(job).toEqual({
      id: 1,
      name: "test-job",
      status: "PENDING",
    });
  });

  it("startJob should throw when job not found", async () => {
    prismaMock.job.findUnique.mockResolvedValueOnce(null);

    await expect(startJob(999)).rejects.toThrow("Job not found");
    expect(prismaMock.job.findUnique).toHaveBeenCalledWith({
      where: { id: 999 },
    });
    expect(redisMock.lpush).not.toHaveBeenCalled();
    expect(prismaMock.job.update).not.toHaveBeenCalled();
  });

  it("startJob should throw when job status is not PENDING", async () => {
    prismaMock.job.findUnique.mockResolvedValueOnce({
      id: 1,
      name: "test-job",
      status: "RUNNING",
    });

    await expect(startJob(1)).rejects.toThrow(
      "Job already started or completed"
    );
    expect(redisMock.lpush).not.toHaveBeenCalled();
    expect(prismaMock.job.update).not.toHaveBeenCalled();
  });

  it("startJob should push to redis queue, update job status to RUNNING and return message", async () => {
    prismaMock.job.findUnique.mockResolvedValueOnce({
      id: 1,
      name: "test-job",
      status: "PENDING",
    });

    const result = await startJob(1);

    expect(redisMock.lpush).toHaveBeenCalledTimes(1);
    const [queueName, payload] = redisMock.lpush.mock.calls[0];
    expect(queueName).toBe("job_queue");
    expect(JSON.parse(payload)).toEqual({
      jobId: 1,
      name: "test-job",
    });

    expect(prismaMock.job.update).toHaveBeenCalledTimes(1);
    expect(prismaMock.job.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: {
        status: "RUNNING",
      },
    });

    expect(result).toEqual({
      message: "Job started",
    });
  });
});

