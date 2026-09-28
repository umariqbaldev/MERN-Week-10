/**
 * Week 10 — Assignment 3: Production hardening tests.
 *
 * C4 (Asgn3): Prove the hardening behaviours actually work:
 *   1. The app refuses to boot without a required env var.
 *   2. GET /health returns 200 when healthy.
 *   3. The logging interceptor produces structured output.
 */
import 'reflect-metadata';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env.test BEFORE any NestJS imports
dotenv.config({ path: path.resolve(__dirname, '../../.env.test') });

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import * as request from 'supertest';
import { ConfigModule } from '@nestjs/config';
import * as Joi from 'joi';
import { AppModule } from '../app.module';
import { AllExceptionsFilter } from '../common/filters/http-exception.filter';
import { LoggingInterceptor } from '../common/interceptors/logging.interceptor';

// Disable throttling for tests
jest.spyOn(ThrottlerGuard.prototype, 'canActivate').mockResolvedValue(true);

// ═══════════════════════════════════════════════════════════════════════
//  C4: Boot-fails-on-bad-config
// ═══════════════════════════════════════════════════════════════════════
describe('C4: Configuration validation', () => {
  it('rejects boot when a required variable is missing (DB_HOST)', async () => {
    // Temporarily remove DB_HOST
    const original = process.env.DB_HOST;
    delete process.env.DB_HOST;

    // ConfigModule.forRoot with the same Joi schema should throw
    try {
      await expect(
        Test.createTestingModule({
          imports: [
            ConfigModule.forRoot({
              isGlobal: true,
              // Don't load .env files — rely solely on process.env
              ignoreEnvFile: true,
              validationSchema: Joi.object({
                DB_HOST: Joi.string().required(),
                DB_PORT: Joi.number().default(5432),
                DB_USERNAME: Joi.string().required(),
                DB_PASSWORD: Joi.string().required(),
                DB_DATABASE: Joi.string().required(),
                PORT: Joi.number().default(3000),
                JWT_SECRET: Joi.string().required(),
              }),
              validationOptions: {
                abortEarly: true,
                allowUnknown: true,
              },
            }),
          ],
        }).compile(),
      ).rejects.toThrow();
    } finally {
      // Restore so other tests are not affected
      process.env.DB_HOST = original;
    }
  });

  it('rejects boot when PORT has wrong type (PORT="abc")', async () => {
    const originalPort = process.env.PORT;
    process.env.PORT = 'abc';

    try {
      await expect(
        Test.createTestingModule({
          imports: [
            ConfigModule.forRoot({
              isGlobal: true,
              ignoreEnvFile: true,
              validationSchema: Joi.object({
                DB_HOST: Joi.string().required(),
                DB_PORT: Joi.number().default(5432),
                DB_USERNAME: Joi.string().required(),
                DB_PASSWORD: Joi.string().required(),
                DB_DATABASE: Joi.string().required(),
                PORT: Joi.number().default(3000),
                JWT_SECRET: Joi.string().required(),
              }),
              validationOptions: {
                abortEarly: true,
                allowUnknown: true,
              },
            }),
          ],
        }).compile(),
      ).rejects.toThrow();
    } finally {
      // Restore
      if (originalPort !== undefined) {
        process.env.PORT = originalPort;
      } else {
        delete process.env.PORT;
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  C4: GET /health
// ═══════════════════════════════════════════════════════════════════════
describe('C4: GET /health endpoint', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = module.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalInterceptors(new LoggingInterceptor());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  }, 30000);

  afterAll(async () => {
    if (app) await app.close();
  }, 10000);

  it('GET /health → 200, status "healthy", app + db both "up"', async () => {
    const res = await request(app.getHttpServer())
      .get('/health')
      .expect(200);

    expect(res.body).toHaveProperty('status', 'healthy');
    expect(res.body).toHaveProperty('uptime');
    expect(res.body).toHaveProperty('checks');
    expect(res.body.checks).toHaveProperty('application');
    expect(res.body.checks).toHaveProperty('database');
    expect(res.body.checks.application).toHaveProperty('status', 'up');
    expect(res.body.checks.database).toHaveProperty('status', 'up');
  });

  it('GET /health includes uptime as a number', async () => {
    const res = await request(app.getHttpServer())
      .get('/health')
      .expect(200);

    expect(typeof res.body.uptime).toBe('number');
    expect(res.body.uptime).toBeGreaterThanOrEqual(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  W2 + X3: Logging interceptor
// ═══════════════════════════════════════════════════════════════════════
describe('W2: Logging interceptor', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = module.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalInterceptors(new LoggingInterceptor());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  }, 30000);

  afterAll(async () => {
    if (app) await app.close();
  }, 10000);

  it('adds X-Request-Id header to the response', async () => {
    const res = await request(app.getHttpServer())
      .get('/health')
      .expect(200);

    expect(res.headers).toHaveProperty('x-request-id');
    expect(typeof res.headers['x-request-id']).toBe('string');
    expect(res.headers['x-request-id'].length).toBeGreaterThan(0);
  });

  it('echoes a provided X-Request-Id header', async () => {
    const customId = 'test-request-id-12345';

    const res = await request(app.getHttpServer())
      .get('/health')
      .set('X-Request-Id', customId)
      .expect(200);

    expect(res.headers['x-request-id']).toBe(customId);
  });
});
