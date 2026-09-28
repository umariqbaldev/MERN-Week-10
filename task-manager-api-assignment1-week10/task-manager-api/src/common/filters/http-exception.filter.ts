import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * C1 (Asgn3): Global exception filter.
 * Every error returns the same 5-field shape:
 *   { statusCode, message, error, timestamp, path }
 *
 * - HttpException messages are preserved.
 * - Non-HttpException becomes a generic 500 — no stack trace or DB details leak.
 *
 * X2 (Asgn3): No secret, password, token, or stack trace reaches the client.
 *
 * X3 (Asgn3): In development (NODE_ENV !== 'production'), the response
 *   includes a `detail` field with the original error message for debugging.
 *   In production, only a generic message is returned for 500s.
 *   The server log always contains the full error in both environments.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';
    let error = 'Internal Server Error';

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      // Derive the human-readable error label
      error = this.getErrorLabel(statusCode);

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (
        typeof exceptionResponse === 'object' &&
        exceptionResponse !== null
      ) {
        const resp = exceptionResponse as Record<string, unknown>;
        message = (resp.message as string | string[]) || exception.message;
      }
    }

    // ── Always log the full error server-side (both environments) ──
    if (statusCode >= 500) {
      this.logger.error(
        `${request.method} ${request.url} → ${statusCode}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn(
        `${request.method} ${request.url} → ${statusCode}: ${JSON.stringify(message)}`,
      );
    }

    // ── Build the response body ────────────────────────────────────
    const body: Record<string, unknown> = {
      statusCode,
      message,
      error,
      path: request.url,
      timestamp: new Date().toISOString(),
    };

    // X3: In development, include detail for 500s to help debugging
    const isDev = process.env.NODE_ENV !== 'production';
    if (isDev && statusCode >= 500 && exception instanceof Error) {
      body.detail = exception.message;
    }

    response.status(statusCode).json(body);
  }

  /** Map a status code to the standard HTTP error label */
  private getErrorLabel(statusCode: number): string {
    const labels: Record<number, string> = {
      400: 'Bad Request',
      401: 'Unauthorized',
      403: 'Forbidden',
      404: 'Not Found',
      409: 'Conflict',
      429: 'Too Many Requests',
      500: 'Internal Server Error',
    };
    return labels[statusCode] || 'Error';
  }
}
