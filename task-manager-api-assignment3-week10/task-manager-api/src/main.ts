import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

const logger = new Logger('Bootstrap');

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const config = app.get(ConfigService);

  // ── C3 (Asgn3): Graceful shutdown — close DB pool on SIGTERM ────
  app.enableShutdownHooks();

  // ── W2 (Asgn3): helmet — sets security headers ──────────────────
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
        },
      },
    }),
  );

  // ── CORS — restrict to the configured origin ────────────────────
  const allowedOrigin =
    config.get<string>('CORS_ORIGIN') || 'http://localhost:3000';
  app.enableCors({
    origin: allowedOrigin,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });

  // ── C1 (Asgn3): Global exception filter — uniform 5-field error shape ──
  app.useGlobalFilters(new AllExceptionsFilter());

  // ── W2 (Asgn3): Logging interceptor — method, path, status, duration ──
  // X2: Redacts secrets. X3: Structured JSON with request ID.
  app.useGlobalInterceptors(new LoggingInterceptor());

  // ── C2 (Asgn3): Global validation pipe — strict, no mass assignment ──
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = config.get<number>('PORT') || 3000;
  await app.listen(port);

  logger.log(`Application running on port ${port}`);
  logger.log(`Graceful shutdown hooks enabled`);
}

// C3: Log shutdown events
process.on('SIGTERM', () => {
  logger.log('SIGTERM received — starting graceful shutdown…');
});
process.on('SIGINT', () => {
  logger.log('SIGINT received — starting graceful shutdown…');
});

bootstrap();
