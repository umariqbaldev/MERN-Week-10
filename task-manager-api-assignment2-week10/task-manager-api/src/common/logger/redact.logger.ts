import { LoggerService as NestLoggerService, Injectable } from '@nestjs/common';

/**
 * X2 (Asgn3): A centralized logger that redacts sensitive keys.
 *
 * Any value associated with a key like password, token, authorization,
 * secret, or cookie is replaced with '[REDACTED]' before being logged.
 * This prevents database passwords, JWTs, and other secrets from
 * leaking through log lines.
 */

const SENSITIVE_KEYS = /password|token|authorization|secret|cookie|hash/i;

function redact(input: unknown): unknown {
  if (typeof input === 'string') {
    // Redact Bearer tokens in strings like "Bearer eyJ..."
    return input.replace(
      /Bearer\s+[A-Za-z0-9\-_\.]+/gi,
      'Bearer [REDACTED]',
    );
  }
  if (Array.isArray(input)) {
    return input.map(redact);
  }
  if (input && typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.test(key)) {
        out[key] = '[REDACTED]';
      } else {
        out[key] = redact(value);
      }
    }
    return out;
  }
  return input;
}

@Injectable()
export class RedactLogger implements NestLoggerService {
  log(message: any, ...optionalParams: any[]) {
    console.log(this.format('LOG', message, optionalParams));
  }

  error(message: any, ...optionalParams: any[]) {
    console.error(this.format('ERROR', message, optionalParams));
  }

  warn(message: any, ...optionalParams: any[]) {
    console.warn(this.format('WARN', message, optionalParams));
  }

  debug(message: any, ...optionalParams: any[]) {
    console.debug(this.format('DEBUG', message, optionalParams));
  }

  verbose(message: any, ...optionalParams: any[]) {
    console.log(this.format('VERBOSE', message, optionalParams));
  }

  private format(level: string, message: any, params: any[]): string {
    const ts = new Date().toISOString();
    const safe = redact(message);
    const safeParams = params.map(redact);
    const extra = safeParams.length ? ` ${JSON.stringify(safeParams)}` : '';
    return `[${ts}] [${level}] ${typeof safe === 'string' ? safe : JSON.stringify(safe)}${extra}`;
  }
}

/** Export the redact function for use in the exception filter */
export { redact };
