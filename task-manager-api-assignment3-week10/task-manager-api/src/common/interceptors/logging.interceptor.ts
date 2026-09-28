import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request, Response } from 'express';
import { randomUUID } from 'crypto';

/**
 * W2 (Asgn3): Logging interceptor — records method, path, status code,
 * and duration for EVERY request (success and error).
 *
 * X2 (Asgn3): Redacts sensitive values — Authorization header becomes
 * "Bearer [REDACTED]", and request bodies with password/token/secret
 * fields have those values replaced.
 *
 * X3 (Asgn3): Structured JSON logs with a request ID that is consistent
 * across all log lines for the same request. The ID is generated from
 * the incoming X-Request-Id header or a new UUID.
 */

// ── X2: Sensitive field pattern ────────────────────────────────────
const SENSITIVE_KEYS = /password|token|authorization|secret|cookie|hash|credit/i;

function redactBody(obj: unknown): unknown {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(redactBody);

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.test(key)) {
      out[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      out[key] = redactBody(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function redactAuthHeader(header: string | undefined): string {
  if (!header) return '-';
  return header.replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]');
}

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();

    // X3: Generate or read request ID
    const requestId =
      (req.headers['x-request-id'] as string) || randomUUID();

    // Attach the requestId to the response header for tracing
    res.setHeader('X-Request-Id', requestId);

    const { method, originalUrl } = req;
    const start = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = Date.now() - start;
          const statusCode = res.statusCode;

          // X3: Structured JSON log line
          const logEntry = {
            requestId,
            method,
            path: originalUrl,
            statusCode,
            duration: `${duration}ms`,
            authorization: redactAuthHeader(req.headers.authorization),
          };

          this.logger.log(JSON.stringify(logEntry));
        },
        error: (err: any) => {
          const duration = Date.now() - start;
          const statusCode = err?.status || err?.getStatus?.() || 500;

          // X2: Redact sensitive body fields before logging
          const safeBody = redactBody(req.body);

          // X3: Structured JSON log line (error path)
          const logEntry = {
            requestId,
            method,
            path: originalUrl,
            statusCode,
            duration: `${duration}ms`,
            error: err?.message || 'Unknown error',
            authorization: redactAuthHeader(req.headers.authorization),
            body: safeBody,
          };

          this.logger.warn(JSON.stringify(logEntry));
        },
      }),
    );
  }
}
