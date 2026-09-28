import { Module } from '@nestjs/common';
import { LoggerService } from './logger.service';

/**
 * X3: Module scope demonstration.
 *
 * LoggerService is declared as a provider AND listed in exports[].
 * This makes it available to any module that imports SharedModule.
 *
 * If you remove LoggerService from the exports array below,
 * HealthModule (which injects LoggerService) will fail to compile with:
 *
 *   "Nest can't resolve dependencies of the HealthService (..., ?, ...).
 *    Please make sure that the argument LoggerService at index [2] is
 *    available in the HealthModule context."
 *
 * This proves that the exports[] array controls cross-module visibility.
 */
@Module({
  providers: [LoggerService],
  exports: [LoggerService], // ← remove this line to break HealthModule
})
export class SharedModule {}
