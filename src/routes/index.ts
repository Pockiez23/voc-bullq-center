import { Elysia } from 'elysia';
import { healthRoute } from '../modules/health/health.route';
import { jobRoute } from '../modules/job/job.route';

export const routes = new Elysia()
  .use(healthRoute)
  .use(jobRoute);
