import { Global, Module } from '@nestjs/common';
import { AppConfigService } from './app-config.service';

/**
 * C2 (Asgn3): Global config module — exports AppConfigService
 * so every module can inject it without importing this module.
 */
@Global()
@Module({
  providers: [AppConfigService],
  exports: [AppConfigService],
})
export class AppConfigModule {}
