import { existsSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import type { Config } from './config.js';
import type { AuthRepository } from './modules/auth/repository.js';
import { authRoutes } from './modules/auth/routes.js';

export type AppDependencies = {
  config: Config;
  auth: AuthRepository;
  checkDatabase: () => Promise<void>;
  staticDirectory?: string;
};

export async function createApp({ config, auth, checkDatabase, staticDirectory }: AppDependencies) {
  const app = express();
  app.disable('x-powered-by');
  // Railway terminates TLS immediately upstream. Local development uses direct requests.
  if (config.nodeEnv === 'production') app.set('trust proxy', 1);
  app.use(helmet({
    strictTransportSecurity: new URL(config.appOrigin).protocol === 'https:' ? undefined : false,
    contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } },
  }));
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.use('/api', (req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('Origin') !== config.appOrigin) {
      res.status(403).json({ error: 'Request origin is not allowed' }); return;
    }
    next();
  });
  app.use(express.json({ limit: '16kb' }));
  app.use(cookieParser());
  app.get('/api/health/live', (_req, res) => res.json({ status: 'ok' }));
  app.get('/api/health/ready', async (_req, res) => {
    try { await checkDatabase(); res.json({ status: 'ready' }); }
    catch { res.status(503).json({ status: 'unavailable' }); }
  });
  app.use('/api/auth', await authRoutes(auth, config));
  // API errors must never be masked by the SPA fallback.
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found' }));
  const staticRoot = staticDirectory ?? path.resolve('dist/client');
  if (existsSync(path.join(staticRoot, 'index.html'))) {
    app.use(express.static(staticRoot));
    app.get('/{*path}', (_req, res) => res.sendFile(path.join(staticRoot, 'index.html')));
  }
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof SyntaxError && 'body' in error) {
      res.status(400).json({ error: 'Invalid JSON body' }); return;
    }
    if (typeof error === 'object' && error !== null && 'type' in error && error.type === 'entity.too.large') {
      res.status(413).json({ error: 'Request body is too large' }); return;
    }
    // Avoid dumping request bodies, cookies, database URLs, or driver error details.
    console.error('Request failed', { name: error instanceof Error ? error.name : 'UnknownError' });
    res.status(500).json({ error: 'Unable to complete this request' });
  });
  return app;
}
