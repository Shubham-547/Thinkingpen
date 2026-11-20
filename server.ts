import fs from 'node:fs';
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
import { flushPendingViews } from './src/lib/jobs.ts';

dotenv.config();

const PORT = Number(process.env.PORT) || 3000;

/**
 * Automatic AVIF / WebP content negotiation middleware for static raster images.
 * Serves pre-generated `.avif` or `.webp` sibling files when supported by the browser's `Accept` header,
 * dramatically cutting bandwidth (up to 95%+) without changing image URLs.
 */
function createImageNegotiationMiddleware(baseDir: string) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const ext = path.extname(req.path).toLowerCase();
    if (!['.png', '.jpg', '.jpeg'].includes(ext)) return next();

    const accept = String(req.headers.accept || '').toLowerCase();
    const cleanRel = req.path.replace(/^\/+/, '');
    const origPath = path.resolve(baseDir, cleanRel);
    if (!origPath.startsWith(path.resolve(baseDir))) return next();

    const stem = origPath.slice(0, -ext.length);
    const candidates: Array<{ file: string; mime: string }> = [];
    if (accept.includes('image/avif')) {
      candidates.push({ file: `${stem}.avif`, mime: 'image/avif' });
    }
    if (accept.includes('image/webp')) {
      candidates.push({ file: `${stem}.webp`, mime: 'image/webp' });
    }

    for (const c of candidates) {
      if (fs.existsSync(c.file)) {
        res.setHeader('Content-Type', c.mime);
        res.setHeader('Vary', 'Accept');
        res.setHeader('Cache-Control', 'public, max-age=604800, stale-while-revalidate=86400');
        return res.sendFile(c.file);
      }
    }

    res.setHeader('Vary', 'Accept');
    return next();
  };
}

/**
 * Same-origin CSRF defense for mutating API endpoints (exempts third-party HMAC webhooks).
 */
function csrfOriginGuard(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return next();
  }
  if (req.originalUrl.startsWith('/api/payments/webhook/')) {
    return next();
  }
  const origin = req.headers.origin;
  if (!origin) return next();

  const forwardedHost = String(req.headers['x-forwarded-host'] || req.headers.host || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  const extraOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  try {
    const parsedOrigin = new URL(origin);
    const originHost = parsedOrigin.host.toLowerCase();
    if (
      originHost === forwardedHost ||
      extraOrigins.includes(origin.toLowerCase()) ||
      (process.env.NODE_ENV !== 'production' &&
        (parsedOrigin.hostname === 'localhost' || parsedOrigin.hostname === '127.0.0.1'))
    ) {
      return next();
    }
  } catch {
    return res.status(403).json({ error: 'Invalid request origin.' });
  }

  return res.status(403).json({ error: 'Cross-origin request blocked by security policy.' });
}

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

  // Allow up to 10mb JSON strictly on creator manuscript save/update; enforce tight 1mb cap everywhere else
  const richContentJsonParser = express.json({ limit: '10mb' });
  app.use('/api/creator/contents', richContentJsonParser);

  // Capture raw body for Razorpay webhook HMAC verification with tight 1mb DoS-safe limit
  app.use(
    express.json({
      limit: '1mb',
      verify: (req, _res, buf) => {
        (req as unknown as { rawBody?: string }).rawBody = buf.toString('utf8');
      },
    })
  );
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // Same-origin CSRF check for mutating API routes
  app.use('/api', csrfOriginGuard);

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

  // Dedicated upload abuse protection (supports chunked + batch gallery uploads cleanly)
  const uploadLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 180,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Upload rate limit reached. Please wait a few minutes and retry.' },
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
  app.use('/api/creator/uploads', uploadLimiter);
  app.use('/api/creator/editor-image', uploadLimiter);

  app.use('/api/auth', authLimiter, authRoutes);
  app.use('/api/catalog', apiLimiter, catalogRoutes);
  app.use('/api/community', apiLimiter, communityRoutes);
  app.use('/api/creator', apiLimiter, creatorRoutes);
  app.use('/api/payments', apiLimiter, paymentRoutes);
  app.use('/api/admin', apiLimiter, adminRoutes);

  app.get('/api/health', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, service: 'scholarpress-api' });
  });

  // Return clean JSON errors for unknown API routes & multer/payload errors
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  app.use(
    (
      err: Error & { code?: string; type?: string; status?: number },
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      if (err.type === 'entity.too.large') {
        return res.status(413).json({ error: 'Request payload is too large.' });
      }
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'Uploaded file exceeds the maximum allowed size limit.' });
      }
      if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).json({ error: 'You can select up to 20 images/videos/files at once.' });
      }
      if (err.message && (err.message.startsWith('Unsupported file') || err.message.startsWith('Only JPG'))) {
        return res.status(400).json({ error: err.message });
      }
      console.error('Unhandled server error:', err);
      return res.status(500).json({ error: 'Internal server error. Please try again.' });
    }
  );

  const setModernImageMime = (res: express.Response, filePath: string) => {
    const lower = filePath.toLowerCase();
    if (lower.endsWith('.avif')) {
      res.setHeader('Content-Type', 'image/avif');
    } else if (lower.endsWith('.webp')) {
      res.setHeader('Content-Type', 'image/webp');
    }
  };

  // Cache static images/assets aggressively + automatic AVIF/WebP negotiation
  const publicAssetsDir = path.resolve(process.cwd(), 'public/assets');
  app.use('/assets', createImageNegotiationMiddleware(publicAssetsDir));
  app.use(
    '/assets',
    express.static(publicAssetsDir, {
      maxAge: '7d',
      etag: true,
      setHeaders: (res, filePath) => {
        setModernImageMime(res, filePath);
        res.setHeader('Cache-Control', 'public, max-age=604800, stale-while-revalidate=86400');
      },
    })
  );

  const srcImagesDir = path.resolve(process.cwd(), 'src/assets/images');
  app.use('/src/assets/images', createImageNegotiationMiddleware(srcImagesDir));
  app.use(
    '/src/assets/images',
    express.static(srcImagesDir, {
      maxAge: '7d',
      etag: true,
      setHeaders: (res, filePath) => {
        setModernImageMime(res, filePath);
        res.setHeader('Cache-Control', 'public, max-age=604800, stale-while-revalidate=86400');
      },
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
          setModernImageMime(res, filePath);
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

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`ScholarPress server listening on http://0.0.0.0:${PORT}`);
  });

  // Graceful shutdown: flush buffered view increments before container terminates
  const shutdown = async (signal: string) => {
    console.log(`Received ${signal}, flushing batched views and shutting down...`);
    await flushPendingViews().catch(() => {});
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

startServer().catch((err) => {
  console.error('Fatal error starting server:', err);
  process.exit(1);
});
