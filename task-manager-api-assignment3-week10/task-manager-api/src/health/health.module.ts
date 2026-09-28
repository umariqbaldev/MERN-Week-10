import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

/**
 * C1 (Asgn3): Health module.
 * DataSource is injected automatically (registered by TypeOrmModule in AppModule).
 * No need to import TypeOrmModule.forFeature — we use DataSource.query() directly.
 */
@Module({
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
