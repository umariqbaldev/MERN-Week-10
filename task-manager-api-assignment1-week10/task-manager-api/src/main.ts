import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { RedactLogger } from './common/logger/redact.logger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    // X2 (Asgn3): Use the redacting logger globally — no secret in log output
    logger: new RedactLogger(),
  });

  const config = app.get(ConfigService);

  // ── W2 (Asgn3): helmet — sets security headers ──────────────────
  // X1 (Asgn3): Content-Security-Policy with real directives
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

  // ── W2 (Asgn3): CORS — restrict to the Next.js dev origin ───────
  const allowedOrigin =
    config.get<string>('CORS_ORIGIN') || 'http://localhost:3000';
  app.enableCors({
    origin: allowedOrigin,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });

  // ── C1 (Asgn3): Global exception filter — uniform 5-field error shape ──
  app.useGlobalFilters(new AllExceptionsFilter());

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
  console.log(`Application running on port ${port}`);
}
bootstrap();
