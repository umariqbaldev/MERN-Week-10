import { Test, TestingModule } from '@nestjs/testing';
import { TaskService } from './task.service';
import { NotificationService } from '../notification/notification.service';

describe('TaskService (X2 — circular dependency)', () => {
  let service: TaskService;

  const mockNotificationService = {
    notify: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TaskService,
        {
          provide: NotificationService,
          useValue: mockNotificationService,
        },
      ],
    }).compile();

    service = module.get<TaskService>(TaskService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return a task title', async () => {
    const title = await service.getTaskTitle(5);
    expect(title).toBe('Task #5');
  });

  it('should fire notification on status update', async () => {
    mockNotificationService.notify.mockResolvedValue(
      '[NOTIFY] Task "Task #3": Status changed to "done"',
    );

    const result = await service.updateTaskStatus(3, 'done');

    expect(result).toBe(
      '[NOTIFY] Task "Task #3": Status changed to "done"',
    );
    expect(mockNotificationService.notify).toHaveBeenCalledWith(
      3,
      'Status changed to "done"',
    );
  });
});
