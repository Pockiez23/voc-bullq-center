import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";

// ---- Global mocks & helpers ----

// Mocked prisma client used by the worker
const prismaJobFindUnique = mock(async (_args: any) => ({
  id: 1,
  name: "Test-Job",
  status: "PENDING",
  is_run: true,
}));

const prismaJobUpdate = mock(async (args: any) => ({
  id: args.where.id,
  ...args.data,
}));

const prismaMock = {
  job: {
    findUnique: prismaJobFindUnique,
    update: prismaJobUpdate,
  },
};

// Mock JobStatus enum from @prisma/client
const JobStatusMock = {
  PENDING: "PENDING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
} as const;

// Mock @prisma/client and src/lib/prisma
mock.module("@prisma/client", () => ({
  JobStatus: JobStatusMock as any,
  PrismaClient: class {},
}));

mock.module("../src/lib/prisma", () => ({
  prisma: prismaMock as any,
}));

// Mock BullMQ Worker so we can capture the processor function
class FakeWorker {
  static lastInstance: FakeWorker | null = null;
  public processor: (job: any) => Promise<any>;
  public name: string;

  constructor(name: string, processor: (job: any) => Promise<any>, _opts: any) {
    this.name = name;
    this.processor = processor;
    FakeWorker.lastInstance = this;
  }

  // used in worker.ts: worker.on('failed', ...)
  on(_event: string, _handler: (...args: any[]) => void) {
    // no-op for unit test
  }
}

mock.module("bullmq", () => ({
  Worker: FakeWorker as any,
}));

// Mock queue connection to avoid real Redis connection
mock.module("../src/queue/job.queue", () => ({
  connection: {} as any,
}));

// Mock global fetch so SOAP call doesn't hit real network
const fetchMock = mock(async (_url: string, _init: any) => {
  return {
    ok: true,
    status: 200,
  } as any;
});

(globalThis as any).fetch = fetchMock;

// Save original timers so we can restore later
const originalSetTimeout = globalThis.setTimeout;
const originalDateNow = Date.now;

// Import the worker after mocks are in place
import { startWorker } from "../src/worker";

describe("BullMQ worker processing (startWorker)", () => {
  beforeEach(() => {
    prismaJobFindUnique.mockClear();
    prismaJobUpdate.mockClear();
    fetchMock.mockClear();
    FakeWorker.lastInstance = null;

    // Make setTimeout execute immediately to avoid real waiting
    (globalThis as any).setTimeout = ((fn: (...args: any[]) => void) => {
      fn();
      return 0 as any;
    }) as any;

    // Control Date.now so that MIN_JOB_DURATION_MS calculation results in no extra wait
    let callCount = 0;
    Date.now = (() => {
      callCount += 1;
      // first call -> jobStartedAt
      if (callCount === 1) {
        return 0;
      }
      // next calls simulate that enough time has already passed
      return 10 * 60 * 1000; // 10 minutes in ms
    }) as any;
  });

  afterEach(() => {
    // Restore globals
    globalThis.setTimeout = originalSetTimeout;
    Date.now = originalDateNow;
  });

  it("should process job successfully and update status to COMPLETED", async () => {
    // Arrange
    // prisma.job.findUnique returns PENDING job (already set in default mock)
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
    } as any);

    // Act: start the worker so it creates FakeWorker instance with processor
    startWorker();

    const workerInstance = FakeWorker.lastInstance;
    expect(workerInstance).not.toBeNull();
    expect(workerInstance?.name).toBe("job-queue");

    // Simulate BullMQ job object
    const fakeJob = {
      data: {
        jobId: 1,
        name: "Test-Job",
      },
    };

    await workerInstance!.processor(fakeJob);

    // Assert DB interactions
    expect(prismaJobFindUnique).toHaveBeenCalledTimes(1);
    expect(prismaJobFindUnique).toHaveBeenCalledWith({
      where: { id: 1 },
    });

    expect(prismaJobUpdate).toHaveBeenCalledTimes(1);
    expect(prismaJobUpdate).toHaveBeenCalledWith({
      where: { id: 1 },
      data: {
        status: JobStatusMock.COMPLETED,
        is_run: false,
      },
    });

    // Assert SOAP call
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("should mark job as FAILED when SOAP request fails", async () => {
    // Arrange: job exists and is not completed/failed
    prismaJobFindUnique.mockResolvedValueOnce({
      id: 1,
      name: "Test Job",
      status: JobStatusMock.PENDING,
      is_run: true,
    });

    // SOAP fails (non-2xx)
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
    } as any);

    startWorker();
    const workerInstance = FakeWorker.lastInstance;
    expect(workerInstance).not.toBeNull();

    const fakeJob = {
      data: {
        jobId: 1,
        name: "Test-Job",
      },
    };

    // Act & Assert: processor should throw, and DB should be updated to FAILED
    await expect(workerInstance!.processor(fakeJob)).rejects.toThrow();

    expect(prismaJobUpdate).toHaveBeenCalled();

    // Last call should set FAILED status
    const lastCall =
      prismaJobUpdate.mock.calls[prismaJobUpdate.mock.calls.length - 1];

    expect(lastCall[0]).toEqual({
      where: { id: 1 },
      data: {
        status: JobStatusMock.FAILED,
        is_run: false,
      },
    });
  });
});

