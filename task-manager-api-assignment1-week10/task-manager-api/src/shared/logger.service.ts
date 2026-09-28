import { Injectable } from '@nestjs/common';

/**
 * X3: A provider that SharedModule exports.
 * Other modules can inject it ONLY if SharedModule lists it in exports[].
 * Removing LoggerService from SharedModule.exports would cause:
 *
 *   Nest can't resolve dependencies of the HealthService (..., ?, ...).
 *   Please make sure that the argument LoggerService at index [2] is
 *   available in the HealthModule context.
 */
@Injectable()
export class LoggerService {
  log(context: string, message: string): string {
    const timestamp = new Date().toISOString();
    const formatted = `[${timestamp}] [${context}] ${message}`;
    console.log(formatted);
    return formatted;
  }
}
