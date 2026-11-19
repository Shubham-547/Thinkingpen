import path from 'node:path';
import express from 'express';
import compression from 'compression';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import authRoutes from './src/routes/auth.ts';
import catalogRoutes, { warmHomeCache } from './src/routes/catalog.ts';
import communityRoutes from './src/routes/community.ts';
import creatorRoutes, { purgeExpiredDeletedContents } from './src/routes/creator.ts';
import paymentRoutes from './src/routes/payments.ts';
import adminRoutes from './src/routes/admin.ts';
import { ensureBaselineCatalog } from './src/db/bootstrap.ts';

dotenv.config();

const PORT = Number(process.env.PORT) || 3000;

async function startServer() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  // Fast Gzip/Deflate compression for JSON APIs, HTML, CSS, and JS bundles
  app.use(compression({ threshold: 512 }));

  // Production HTTP security headers (iframe-safe & Google Sign-In popup compatible)
  app.use(
    helmet({
      frameguard: false,
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
      },
      noSniff: true,
    })
  );

  app.use((_req, res, next) => {
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(self)');
    next();
  });

  // Capture raw body for Razorpay webhook HMAC verification
  app.use(
    express.json({
      limit: '15mb',
      verify: (req, _res, buf) => {
        (req as unknown as { rawBody?: string }).rawBody = buf.toString('utf8');
      },
    })
  );
  app.use(express.urlencoded({ extended: true, limit: '15mb' }));

  // Strict brute-force protection on sensitive auth actions (login/register/password reset)
  const strictAuthLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many attempts. Please wait 15 minutes and try again.' },
  });

  // General auth session limiter
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many authentication requests. Please try again shortly.' },
  });

  // Anti-spam limiter on public contact submissions
  const contactLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many inquiries submitted. Please try again later.' },
  });

  const apiLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 600,
    standardHeaders: true,
    legacyHeaders: false,
  });

  app.use('/api/auth/login', strictAuthLimiter);
  app.use('/api/auth/register', strictAuthLimiter);
  app.use('/api/auth/forgot-password', strictAuthLimiter);
  app.use('/api/auth/reset-password', strictAuthLimiter);
  app.use('/api/catalog/contact', contactLimiter);

  app.use('/api/auth', authLimiter, authRoutes);
  app.use('/api/catalog', apiLimiter, catalogRoutes);
  app.use('/api/community', apiLimiter, communityRoutes);
  app.use('/api/creator', apiLimiter, creatorRoutes);
  app.use('/api/payments', apiLimiter, paymentRoutes);
  app.use('/api/admin', apiLimiter, adminRoutes);

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'scholarpress-api' });
  });

  // Return clean JSON errors for unknown API routes & multer errors
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  app.use(
    (
      err: Error & { code?: string },
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      console.error('Unhandled server error:', err);
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'Uploaded file exceeds the 50 MB size limit.' });
      }
      if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).json({ error: 'You can select up to 20 images/videos/files at once.' });
      }
      if (err.message && (err.message.startsWith('Unsupported file') || err.message.startsWith('Only JPG'))) {
        return res.status(400).json({ error: err.message });
      }
      return res.status(500).json({ error: 'Internal server error. Please try again.' });
    }
  );

  // Cache static images/assets aggressively for instant repeat loads
  app.use(
    '/assets',
    express.static(path.resolve(process.cwd(), 'public/assets'), {
      maxAge: '7d',
      etag: true,
    })
  );

  // Frontend delivery: Vite dev middleware in development, static dist/ in production
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(
      express.static(distDir, {
        maxAge: '1d',
        etag: true,
        setHeaders: (res, filePath) => {
          if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          } else if (filePath.endsWith('index.html')) {
            res.setHeader('Cache-Control', 'no-cache');
          }
        },
      })
    );
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  await ensureBaselineCatalog();
  warmHomeCache().catch(() => {});
  purgeExpiredDeletedContents().catch((err) => {
    console.warn('Initial 15-day soft-delete purge warning:', err);
  });
  const purgeTimer = setInterval(() => {
    purgeExpiredDeletedContents().catch((err) => {
      console.warn('Scheduled 15-day soft-delete purge warning:', err);
    });
  }, 60 * 60 * 1000);
  purgeTimer.unref?.();

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ScholarPress server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal error starting server:', err);
  process.exit(1);
});
