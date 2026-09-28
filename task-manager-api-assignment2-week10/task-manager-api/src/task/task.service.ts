import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { NotificationService } from '../notification/notification.service';

/**
 * X2: TaskService depends on NotificationService (circular).
 * Uses forwardRef(() => NotificationService) to break the cycle.
 */
@Injectable()
export class TaskService {
  constructor(
    @Inject(forwardRef(() => NotificationService))
    private readonly notificationService: NotificationService,
  ) {}

  async getTaskTitle(taskId: number): Promise<string> {
    // Simplified — in a real app this would query the repository
    return `Task #${taskId}`;
  }

  async updateTaskStatus(taskId: number, status: string): Promise<string> {
    // After updating status, fire a notification
    return this.notificationService.notify(
      taskId,
      `Status changed to "${status}"`,
    );
  }
}
