import type { FastifyInstance } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { config } from './env.js';

/**
 * Registers Swagger (OpenAPI 3.0) + Swagger UI.
 *
 * IMPORTANT: Shared schemas are registered via app.addSchema() so they are
 * available to BOTH Fastify's ajv validator AND the Swagger spec generator.
 * Reference them in routes using { $ref: 'SchemaId#' } (Fastify format).
 */
export async function registerDocs(app: FastifyInstance) {
  // --- Register shared schemas into ajv + Swagger ---
  // These can be referenced in route schemas as { $ref: 'SchemaId#' }

  app.addSchema({
    $id: 'RegisterBody',
    type: 'object',
    required: ['email', 'password', 'fullName'],
    properties: {
      email: { type: 'string', format: 'email', example: 'student@example.com' },
      password: { type: 'string', minLength: 8, maxLength: 128, example: 'MyPass1234!' },
      fullName: { type: 'string', minLength: 2, maxLength: 100, example: 'John Doe' },
      role: { type: 'string', enum: ['student', 'instructor', 'admin'], default: 'student' },
    },
  });

  app.addSchema({
    $id: 'LoginBody',
    type: 'object',
    required: ['email', 'password'],
    properties: {
      email: { type: 'string', format: 'email', example: 'admin@example.com' },
      password: { type: 'string', minLength: 1, maxLength: 128, example: 'Admin1234!' },
    },
  });

  app.addSchema({
    $id: 'UserProfile',
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      email: { type: 'string', format: 'email' },
      name: { type: 'string' },
      role: { type: 'string', enum: ['student', 'instructor', 'admin'] },
      avatarUrl: { type: 'string', nullable: true },
      geminiApiKey: { type: 'string', nullable: true },
      enrolledCourseIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
    },
  });

  app.addSchema({
    $id: 'AuthResponse',
    type: 'object',
    properties: {
      user: { $ref: 'UserProfile#' },
      accessToken: { type: 'string', description: 'Short-lived JWT (15 min)' },
    },
  });

  app.addSchema({
    $id: 'MessageResponse',
    type: 'object',
    properties: { message: { type: 'string' } },
  });

  app.addSchema({
    $id: 'ErrorResponse',
    type: 'object',
    properties: {
      error: { type: 'string', example: 'UNAUTHORIZED' },
      message: { type: 'string', example: 'Invalid or expired token' },
    },
  });

  app.addSchema({
    $id: 'Course',
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      title: { type: 'string' },
      subtitle: { type: 'string', nullable: true },
      instructor: { type: 'string' },
      instructorId: { type: 'string', format: 'uuid' },
      description: { type: 'string' },
      price: { type: 'number' },
      rating: { type: 'number' },
      ratingCount: { type: 'integer' },
      thumbnailUrl: { type: 'string', nullable: true },
      category: { type: 'string' },
      level: { type: 'string', enum: ['Beginner', 'Intermediate', 'Advanced'] },
      isPublished: { type: 'boolean' },
      approvalStatus: { type: 'string', enum: ['draft', 'pending', 'approved', 'rejected'] },
    },
  });

  app.addSchema({
    $id: 'CreateCourseBody',
    type: 'object',
    required: ['title', 'description', 'price', 'category'],
    properties: {
      title: { type: 'string', minLength: 3, maxLength: 200, example: 'Learn TypeScript' },
      subtitle: { type: 'string', example: 'From beginner to advanced' },
      description: { type: 'string', minLength: 10, example: 'A comprehensive TypeScript course' },
      price: { type: 'number', minimum: 0, example: 299000 },
      category: { type: 'string', example: 'Programming' },
      level: { type: 'string', enum: ['Beginner', 'Intermediate', 'Advanced'], default: 'Beginner' },
      thumbnailUrl: { type: 'string', format: 'uri' },
      learningObjectives: { type: 'array', items: { type: 'string' } },
      requirements: { type: 'array', items: { type: 'string' } },
    },
  });

  app.addSchema({
    $id: 'CreateTransactionBody',
    type: 'object',
    required: ['totalAmount', 'items'],
    properties: {
      totalAmount: { type: 'number', example: 299000 },
      proofUrl: { type: 'string', format: 'uri' },
      items: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          required: ['itemId', 'itemType', 'price', 'title'],
          properties: {
            itemId: { type: 'string', format: 'uuid' },
            itemType: { type: 'string', enum: ['course', 'bundle'] },
            price: { type: 'number' },
            title: { type: 'string' },
          },
        },
      },
    },
  });

  // --- Register Swagger plugin ---
  await app.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'NextSkill LMS API',
        description: `
## NextSkill LMS – REST API

Complete backend for the NextSkill Learning Management System.

### Authentication
1. Call **POST /api/auth/login**
2. Copy the \`accessToken\` from the response
3. Click **Authorize 🔓** and enter: \`Bearer <your_token>\`
        `.trim(),
        version: '1.0.0',
      },
      servers: [
        {
          url: `http://${config.server.host === '0.0.0.0' ? 'localhost' : config.server.host}:${config.server.port}`,
          description: config.server.isDev ? 'Local Development' : 'Server',
        },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
      security: [{ bearerAuth: [] }],
      tags: [
        { name: 'Auth', description: 'Authentication & session management' },
        { name: 'Users', description: 'User management (Admin only)' },
        { name: 'Courses', description: 'Course catalog and content management' },
        { name: 'Modules & Lessons', description: 'Course structure management' },
        { name: 'Progress', description: 'Student lesson progress' },
        { name: 'Enrollments', description: 'Enrollment management' },
        { name: 'Payments', description: 'Manual payment transactions' },
        { name: 'Certificates', description: 'Course completion certificates' },
        { name: 'Reviews', description: 'Course reviews and ratings' },
        { name: 'Notifications', description: 'User notifications & broadcast' },
        { name: 'Discussions', description: 'Lesson comments and replies' },
        { name: 'Assignments', description: 'Submissions and grading' },
        { name: 'Assets', description: 'File & media management' },
        { name: 'Bundles', description: 'Course bundle management' },
        { name: 'Categories', description: 'Course categories' },
        { name: 'Live Classes', description: 'Scheduled live sessions' },
        { name: 'Settings', description: 'App settings (Admin only)' },
        { name: 'Question Bank', description: 'Quiz question bank' },
      ],
    },
  });

  // --- Register Swagger UI ---
  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
      persistAuthorization: true,
      displayRequestDuration: true,
      filter: true,
      tryItOutEnabled: true,
      syntaxHighlight: { activate: true, theme: 'monokai' },
    },
    staticCSP: false,
    theme: {
      title: 'NextSkill LMS API Docs',
      css: [
        {
          filename: 'theme.css',
          content: `
            .swagger-ui .topbar { background: #312e81 !important; }
            .swagger-ui .btn.authorize { border-color: #6366f1; color: #6366f1; }
            .swagger-ui .btn.authorize:hover { background: #6366f1; color: white; }
            .swagger-ui .opblock.opblock-post .opblock-summary { background: #ede9fe; }
            .swagger-ui .opblock.opblock-get .opblock-summary { background: #e0f2fe; }
            .swagger-ui .opblock.opblock-patch .opblock-summary { background: #fef9c3; }
            .swagger-ui .opblock.opblock-delete .opblock-summary { background: #fee2e2; }
            .swagger-ui .opblock-tag { font-size: 16px !important; font-weight: 700; }
          `,
        },
      ],
    },
  });
}
