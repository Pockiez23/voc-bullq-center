import { Elysia } from 'elysia';
import { getJobs, createJob } from './job.controller';

export const jobRoute = new Elysia({ prefix: '/jobs' })
  .get('/', getJobs)
  .post('/', ({ body }) => createJob(body as { name: string }));
