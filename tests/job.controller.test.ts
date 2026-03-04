import { describe, it, expect, beforeEach, mock } from "bun:test";

// Mock prisma from config/db before importing controller
const prismaMock = {
  job: {
    findMany: mock(async () => [
      { id: 1, name: "job-1" },
      { id: 2, name: "job-2" },
    ]),
    create: mock(async (args: any) => ({
      id: 3,
      name: args.data.name,
    })),
  },
};

mock.module("../src/config/db", () => ({
  prisma: prismaMock as any,
}));

import { getJobs, createJob } from "../src/modules/job/job.controller";

describe("job.controller", () => {
  beforeEach(() => {
    prismaMock.job.findMany.mockClear();
    prismaMock.job.create.mockClear();
  });

  it("getJobs should return list of jobs from prisma", async () => {
    const jobs = await getJobs();

    expect(prismaMock.job.findMany).toHaveBeenCalledTimes(1);
    expect(jobs).toEqual([
      { id: 1, name: "job-1" },
      { id: 2, name: "job-2" },
    ]);
  });

  it("createJob should create job with given name", async () => {
    const body = { name: "new-job" };

    const job = await createJob(body);

    expect(prismaMock.job.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.job.create).toHaveBeenCalledWith({
      data: {
        name: "new-job",
      },
    });
    expect(job).toEqual({
      id: 3,
      name: "new-job",
    });
  });
});

