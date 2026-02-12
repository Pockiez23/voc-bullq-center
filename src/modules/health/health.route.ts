import { Elysia } from 'elysia';
import { healthCheck } from './health.controller';

export const healthRoute = new Elysia({ prefix: '/health' })
  .get('/', healthCheck);
