import { prisma } from '../../config/db';

export const getJobs = async () => {
  const jobs = await prisma.job.findMany();
  return jobs;
};

export const createJob = async (body: { name: string }) => {
  const job = await prisma.job.create({
    data: {
      name: body.name,
    },
  });

  return job;
};
