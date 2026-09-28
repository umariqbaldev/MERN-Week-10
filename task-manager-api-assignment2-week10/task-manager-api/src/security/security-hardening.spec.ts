import { Test, TestingModule } from '@nestjs/testing';
import {
  INestApplication,
  ValidationPipe,
  Controller,
  Get,
  Post,
  Body,
  Param,
  NotFoundException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { Throttle } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import * as request from 'supertest';
import { AllExceptionsFilter } from '../common/filters/http-exception.filter';
import { ParsePositiveIntPipe } from '../common/pipes/parse-positive-int.pipe';

/**
 * C5 (Asgn3): Security-hardening tests.
 *
 *  1) Throttle test  — rapid auth-route requests → 429 Too Many Requests.
 *  2) Error-shape test — every error returns the 5-field body:
 *       { statusCode, message, error, timestamp, path }
 */

// ─── Minimal test controllers ──────────────────────────────────────
// We use isolated controllers so these tests do not depend on a database
// or on the full app module.

@Controller('fake-auth')
@Throttle({ default: { limit: 3, ttl: 60000 } }) // very tight for testing
class FakeAuthController {
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() _dto: any) {
    return { access_token: 'test' };
  }
}

@Controller('fake-items')
class FakeItemsController {
  @Get(':id')
  findOne(@Param('id', ParsePositiveIntPipe) id: number) {
    if (id === 999) {
      throw new NotFoundException(`Item with id ${id} not found`);
    }
    return { id, name: 'Test item' };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() _dto: any) {
    return { id: 1 };
  }
}

// ════════════════════════════════════════════════════════════════════
//  TEST SUITE
// ════════════════════════════════════════════════════════════════════

describe('C5: Security Hardening', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        // Very tight global throttle so we can trigger 429 quickly
        ThrottlerModule.forRoot({
          throttlers: [{ ttl: 60000, limit: 20 }], // generous global
        }),
      ],
      controllers: [FakeAuthController, FakeItemsController],
      providers: [
        { provide: APP_GUARD, useClass: ThrottlerGuard },
      ],
    }).compile();

    app = module.createNestApplication();

    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  // ══════════════════════════════════════════════════════════════════
  //  C5 — Test 1: Rate-limiting (throttle) → 429
  // ══════════════════════════════════════════════════════════════════
  describe('W1 + C5: rate-limiting → 429', () => {
    it('rapid auth-route requests should be throttled after the limit', async () => {
      // FakeAuthController has @Throttle limit: 3 per 60s
      // Fire 4 requests — the 4th should be 429
      const server = app.getHttpServer();

      for (let i = 0; i < 3; i++) {
        await request(server)
          .post('/fake-auth/login')
          .send({ email: 'a@b.com', password: 'x' })
          .expect(200);
      }

      // 4th request exceeds the limit → 429
      const res = await request(server)
        .post('/fake-auth/login')
        .send({ email: 'a@b.com', password: 'x' })
        .expect(429);

      expect(res.body.statusCode).toBe(429);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  C5 — Test 2: Uniform 5-field error shape
  // ══════════════════════════════════════════════════════════════════
  describe('C1 + C5: uniform 5-field error shape', () => {
    /** Helper: asserts the 5 required keys are present and correctly typed */
    function assertErrorShape(body: any, expectedStatus: number) {
      expect(body).toHaveProperty('statusCode', expectedStatus);
      expect(body).toHaveProperty('message');
      expect(body).toHaveProperty('error');
      expect(body).toHaveProperty('timestamp');
      expect(body).toHaveProperty('path');

      // Types
      expect(typeof body.statusCode).toBe('number');
      expect(typeof body.error).toBe('string');
      expect(typeof body.timestamp).toBe('string');
      expect(typeof body.path).toBe('string');

      // No stack trace leaked
      expect(body).not.toHaveProperty('stack');
      expect(body).not.toHaveProperty('trace');
    }

    it('400 Bad Request (invalid :id param) returns 5-field shape', async () => {
      const res = await request(app.getHttpServer())
        .get('/fake-items/abc')
        .expect(400);

      assertErrorShape(res.body, 400);
      expect(res.body.error).toBe('Bad Request');
      expect(res.body.path).toContain('/fake-items/abc');
    });

    it('404 Not Found returns 5-field shape', async () => {
      const res = await request(app.getHttpServer())
        .get('/fake-items/999')
        .expect(404);

      assertErrorShape(res.body, 404);
      expect(res.body.error).toBe('Not Found');
      expect(res.body.message).toContain('not found');
    });

    it('400 from zero/negative :id returns 5-field shape', async () => {
      const res = await request(app.getHttpServer())
        .get('/fake-items/0')
        .expect(400);

      assertErrorShape(res.body, 400);
      expect(res.body.error).toBe('Bad Request');
    });

    it('400 from negative :id returns 5-field shape', async () => {
      const res = await request(app.getHttpServer())
        .get('/fake-items/-5')
        .expect(400);

      assertErrorShape(res.body, 400);
    });
  });
});
