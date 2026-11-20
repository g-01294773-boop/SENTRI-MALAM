import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { seedInitialDataOnce } from './server/db.ts';
import authRoutes from './server/routes/auth.ts';
import coordinatorRoutes from './server/routes/coordinator.ts';
import reportRoutes from './server/routes/reports.ts';
import scheduleRoutes from './server/routes/schedule.ts';

dotenv.config();

seedInitialDataOnce();

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);

  app.use(cookieParser());
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api', scheduleRoutes);
  app.use('/api', reportRoutes);
  app.use('/api/coordinator', coordinatorRoutes);

  // Return JSON 404 for unknown /api/* routes
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Laluan API tidak ditemui.' });
  });

  // Global JSON error handler for API requests
  app.use(
    '/api',
    (
      err: Error & { status?: number },
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
      res.status(status).json({
        error: err.message || 'Ralat dalaman pelayan berlaku.',
      });
    }
  );

  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('/{*splat}', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build dist/index.html belum dijana.');
      }
    });
  }

  const PORT = Number(process.env.PORT || 3000);
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Pelayan Sentri Malam SK Tudan berjalan pada port ${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Gagal memulakan pelayan:', err);
  process.exit(1);
});
