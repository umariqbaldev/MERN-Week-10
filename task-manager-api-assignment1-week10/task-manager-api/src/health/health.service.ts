import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Task } from '../entities/task.entity';
import { Project } from '../entities/project.entity';
import { LoggerService } from '../shared/logger.service';

@Injectable()
export class HealthService {
  constructor(
    // ── W2: Inject Task repository ──────────────────────────────────
    @InjectRepository(Task)
    private readonly taskRepository: Repository<Task>,

    // ── C3: Second provider — inject Project repository ─────────────
    @InjectRepository(Project)
    private readonly projectRepository: Repository<Project>,

    // ── X3: Injected from SharedModule (cross-module visibility) ────
    private readonly logger: LoggerService,
  ) {}

  /**
   * C1: Count rows in the tasks table — proves DB connectivity.
   */
  async getTaskCount(): Promise<number> {
    return this.taskRepository.count();
  }

  /**
   * C3: Count rows in the projects table — second provider usage.
   */
  async getProjectCount(): Promise<number> {
    return this.projectRepository.count();
  }

  /**
   * Combined DB health check using both providers + logger.
   */
  async getDatabaseHealth(): Promise<{
    status: string;
    taskCount: number;
    projectCount: number;
  }> {
    const [taskCount, projectCount] = await Promise.all([
      this.getTaskCount(),
      this.getProjectCount(),
    ]);

    // X3: Use the cross-module LoggerService
    this.logger.log('HealthService', `DB check: ${taskCount} tasks, ${projectCount} projects`);

    return {
      status: 'ok',
      taskCount,
      projectCount,
    };
  }
}
