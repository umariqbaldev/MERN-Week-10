import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { TaskService } from '../task/task.service';

/**
 * X2: NotificationService depends on TaskService (to look up task details
 * when sending notifications). TaskService also depends on
 * NotificationService (to fire notifications on task updates).
 *
 * This creates a circular dependency:
 *   NotificationModule → TaskModule → NotificationModule
 *
 * Fixed with forwardRef(() => TaskService) in both the module imports
 * and the @Inject() decorator.
 */
@Injectable()
export class NotificationService {
  constructor(
    @Inject(forwardRef(() => TaskService))
    private readonly taskService: TaskService,
  ) {}

  async notify(taskId: number, message: string): Promise<string> {
    // Look up task title for the notification
    const title = await this.taskService.getTaskTitle(taskId);
    return `[NOTIFY] Task "${title}": ${message}`;
  }
}
