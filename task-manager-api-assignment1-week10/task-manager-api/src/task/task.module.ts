import { Module, forwardRef } from '@nestjs/common';
import { TaskService } from './task.service';
import { NotificationModule } from '../notification/notification.module';

/**
 * X2: forwardRef(() => NotificationModule) to resolve the circular
 * dependency with NotificationModule.
 */
@Module({
  imports: [forwardRef(() => NotificationModule)],
  providers: [TaskService],
  exports: [TaskService],
})
export class TaskModule {}
