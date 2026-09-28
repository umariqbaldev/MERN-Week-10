import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Task } from '../entities/task.entity';
import { Project } from '../entities/project.entity';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { SharedModule } from '../shared/shared.module';

@Module({
  imports: [
    // ── W2: Register entities with TypeOrmModule.forFeature ─────────
    TypeOrmModule.forFeature([Task, Project]),

    // ── X3: Import SharedModule to access its exported LoggerService ─
    SharedModule,
  ],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
