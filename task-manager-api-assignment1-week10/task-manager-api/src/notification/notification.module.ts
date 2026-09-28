import { Module, forwardRef } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { TaskModule } from '../task/task.module';

/**
 * X2: Circular dependency resolution.
 *
 * NotificationModule ↔ TaskModule form a cycle.
 * Without forwardRef, NestJS throws:
 *   "A circular dependency has been detected. Please, make sure that
 *    each side of a bidirectional relationship is decorated with
 *    forwardRef(() => ...)."
 *
 * Fix: forwardRef(() => TaskModule) here AND forwardRef(() => NotificationModule)
 * in TaskModule.
 *
 * NOTE (PR comment): A SharedModule that both import would have been cleaner
 * here — it avoids the cycle entirely by extracting the shared dependency.
 * forwardRef is the quick fix; a shared module is the better architecture.
 */
@Module({
  imports: [forwardRef(() => TaskModule)],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}
