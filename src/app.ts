import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import cookie from '@fastify/cookie';
import path from 'path';
import fs from 'fs';
import { config } from './config/env.js';
import { AppError } from './shared/errors.js';
import { registerDocs } from './config/swagger.js';

// --- Route Imports ---
import { authRoutes } from './modules/auth/auth.routes.js';
import { userRoutes } from './modules/users/users.routes.js';
import { courseRoutes } from './modules/courses/courses.routes.js';
import { enrollmentRoutes } from './modules/enrollments/enrollments.routes.js';
import { paymentRoutes } from './modules/payments/payments.routes.js';
import { certificateRoutes } from './modules/certificates/certificates.routes.js';
import { reviewRoutes } from './modules/reviews/reviews.routes.js';
import { notificationRoutes } from './modules/notifications/notifications.routes.js';
import { discussionRoutes } from './modules/discussions/discussions.routes.js';
import { assignmentRoutes } from './modules/assignments/assignments.routes.js';
import { assetRoutes } from './modules/assets/assets.routes.js';
import { bundleRoutes } from './modules/bundles/bundles.routes.js';
import { categoryRoutes } from './modules/categories/categories.routes.js';
import { liveClassRoutes } from './modules/liveClasses/liveClasses.routes.js';
import { settingsRoutes } from './modules/settings/settings.routes.js';
import { questionBankRoutes } from './modules/questionBank/questionBank.routes.js';

export async function buildApp() {
  const app = Fastify({
    logger: { level: config.server.isDev ? 'info' : 'warn' },
    trustProxy: true,
    // Allow OpenAPI keywords (example, description, nullable) in schemas
    // without breaking ajv's strict-mode validation
    ajv: {
      customOptions: {
        strict: false,
        allErrors: true,
      },
    },
  });

  // --- 1. Docs (must register BEFORE routes so all schemas are captured) ---
  await registerDocs(app);

  // --- 2. Security & CORS ---
  await app.register(helmet, {
    contentSecurityPolicy: false, // Swagger UI needs inline scripts
  });

  await app.register(cors, {
    origin: (origin, cb) => {
      // Always allow: no origin (same-origin / non-browser / curl), or any localhost/127.0.0.1 port
      if (!origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
        return cb(null, true);
      }
      // Everything else: check against explicit allowlist (CORS_ORIGINS env var)
      if (config.cors.origins.includes(origin)) return cb(null, true);
      cb(new Error('Not allowed by CORS'), false);
    },
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // --- 3. Rate Limiting ---
  await app.register(rateLimit, {
    global: true,
    max: 200,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({
      statusCode: 429,
      error: 'Too Many Requests',
      message: 'You are sending requests too fast. Please slow down.',
    }),
  });

  // --- 4. Cookies (HttpOnly refresh token) ---
  await app.register(cookie, {
    secret: config.jwt.secret,
    parseOptions: {},
  });

  // --- 5. File Upload ---
  await app.register(multipart, {
    limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB
  });

  // --- 6. Static Files / Asset Serving (Abstracted for Multi-Provider storage) ---
  app.get('/assets', {
    schema: { hide: true },
  }, async (request, reply) => {
    const { bucket, file } = request.query as { bucket?: string; file?: string };
    
    if (!bucket || !file) {
      return reply.status(400).send({ error: 'Missing bucket or file parameter' });
    }

    // For now, only 'local' bucket is supported.
    // In the future: if (bucket === 's3') ... redirect to signed S3 URL or fetch and stream
    if (bucket === 'local') {
      const safeName = path.basename(file); // prevent path traversal
      const filePath = path.resolve(config.storage.uploadDir, safeName);
      if (!fs.existsSync(filePath)) return reply.status(404).send({ error: 'File not found' });
      const stream = fs.createReadStream(filePath);
      return reply.send(stream);
    }
    
    return reply.status(400).send({ error: `Bucket provider '${bucket}' not supported or invalid` });
  });

  // --- 7. Global Error Handler ---
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        error: error.code || 'ERROR',
        message: error.message,
      });
    }
    if (error.validation) {
      return reply.status(400).send({
        error: 'VALIDATION_ERROR',
        message: 'Invalid request body',
        details: error.validation,
      });
    }
    if (error.statusCode === 429) {
      return reply.status(429).send({ error: 'TOO_MANY_REQUESTS', message: error.message });
    }
    request.log.error(error);
    return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'An unexpected error occurred' });
  });

  // --- 7. Health Check ---
  app.get('/health', {
    schema: {
      hide: true, // Hide from docs
    },
  }, async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  // --- 8. API Routes ---
  const API_PREFIX = '/api';
  app.register(authRoutes, { prefix: `${API_PREFIX}/auth` });
  app.register(userRoutes, { prefix: `${API_PREFIX}/users` });
  app.register(courseRoutes, { prefix: `${API_PREFIX}/courses` });
  app.register(enrollmentRoutes, { prefix: `${API_PREFIX}/enrollments` });
  app.register(paymentRoutes, { prefix: `${API_PREFIX}/payments` });
  app.register(certificateRoutes, { prefix: `${API_PREFIX}/certificates` });
  app.register(reviewRoutes, { prefix: `${API_PREFIX}/reviews` });
  app.register(notificationRoutes, { prefix: `${API_PREFIX}/notifications` });
  app.register(discussionRoutes, { prefix: `${API_PREFIX}/discussions` });
  app.register(assignmentRoutes, { prefix: `${API_PREFIX}/assignments` });
  app.register(assetRoutes, { prefix: `${API_PREFIX}/assets` });
  app.register(bundleRoutes, { prefix: `${API_PREFIX}/bundles` });
  app.register(categoryRoutes, { prefix: `${API_PREFIX}/categories` });
  app.register(liveClassRoutes, { prefix: `${API_PREFIX}/live-classes` });
  app.register(settingsRoutes, { prefix: `${API_PREFIX}/settings` });
  app.register(questionBankRoutes, { prefix: `${API_PREFIX}/question-bank` });

  return app;
}
