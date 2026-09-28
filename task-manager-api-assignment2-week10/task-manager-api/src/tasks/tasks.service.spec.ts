import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { Task, TaskStatus } from '../entities/task.entity';
import { Project } from '../entities/project.entity';
import { User } from '../entities/user.entity';
import { Tag } from '../entities/tag.entity';
import { ProjectMember } from '../entities/project-member.entity';

describe('TasksService', () => {
  let service: TasksService;

  // ── Mock repositories ──────────────────────────────────────────────
  const mockTaskRepository = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    findOneBy: jest.fn(),
    remove: jest.fn(),
    createQueryBuilder: jest.fn(),
  };

  const mockProjectRepository = {
    findOneBy: jest.fn(),
  };

  const mockUserRepository = {
    findOneBy: jest.fn(),
  };

  const mockTagRepository = {
    findBy: jest.fn(),
  };

  const mockMemberRepository = {
    findOne: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TasksService,
        { provide: getRepositoryToken(Task), useValue: mockTaskRepository },
        { provide: getRepositoryToken(Project), useValue: mockProjectRepository },
        { provide: getRepositoryToken(User), useValue: mockUserRepository },
        { provide: getRepositoryToken(Tag), useValue: mockTagRepository },
        { provide: getRepositoryToken(ProjectMember), useValue: mockMemberRepository },
      ],
    }).compile();

    service = module.get<TasksService>(TasksService);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ── C4: Validate relations — 404 not 500 ──────────────────────────
  describe('create', () => {
    it('should throw NotFoundException when projectId does not exist', async () => {
      mockProjectRepository.findOneBy.mockResolvedValue(null);

      await expect(
        service.create({
          title: 'Test Task',
          projectId: 999,
        }, 1),
      ).rejects.toThrow(NotFoundException);

      expect(mockProjectRepository.findOneBy).toHaveBeenCalledWith({ id: 999 });
    });

    it('should throw NotFoundException when assigneeId does not exist', async () => {
      mockProjectRepository.findOneBy.mockResolvedValue({ id: 1 });
      mockUserRepository.findOneBy.mockResolvedValue(null);

      await expect(
        service.create({
          title: 'Test Task',
          projectId: 1,
          assigneeId: 999,
        }, 1),
      ).rejects.toThrow(NotFoundException);

      expect(mockUserRepository.findOneBy).toHaveBeenCalledWith({ id: 999 });
    });

    it('should create and return a task with creator_id set (W2)', async () => {
      const fakeProject = { id: 1, name: 'Project A' };
      const fakeUser = { id: 2, name: 'Alice' };
      const fakeSavedTask = { id: 10, title: 'Test Task', project_id: 1, creator_id: 5 };
      const fakeFullTask = {
        ...fakeSavedTask,
        project: fakeProject,
        assignee: fakeUser,
        tags: [],
        commentCount: 0,
      };

      // findOne now uses createQueryBuilder
      const mockQb = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        loadRelationCountAndMap: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(fakeFullTask),
      };

      mockProjectRepository.findOneBy.mockResolvedValue(fakeProject);
      mockUserRepository.findOneBy.mockResolvedValue(fakeUser);
      mockTaskRepository.create.mockReturnValue(fakeSavedTask);
      mockTaskRepository.save.mockResolvedValue(fakeSavedTask);
      mockTaskRepository.createQueryBuilder.mockReturnValue(mockQb);

      const result = await service.create({
        title: 'Test Task',
        projectId: 1,
        assigneeId: 2,
      }, 5);

      expect(result).toEqual(fakeFullTask);
      expect(mockTaskRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          creator_id: 5,
          project_id: 1,
        }),
      );
    });
  });

  // ── findOne (X2: query builder with commentCount) ──────────────────
  describe('findOne', () => {
    const mockQb = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      loadRelationCountAndMap: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn(),
    };

    beforeEach(() => {
      mockTaskRepository.createQueryBuilder.mockReturnValue(mockQb);
    });

    it('should return a task with relations and commentCount', async () => {
      const fakeTask = {
        id: 1,
        title: 'Task 1',
        project: {},
        assignee: {},
        tags: [],
        commentCount: 5,
      };
      mockQb.getOne.mockResolvedValue(fakeTask);

      const result = await service.findOne(1);

      expect(result).toEqual(fakeTask);
      expect(mockQb.leftJoinAndSelect).toHaveBeenCalledWith('task.project', 'project');
      expect(mockQb.leftJoinAndSelect).toHaveBeenCalledWith('task.assignee', 'assignee');
      expect(mockQb.leftJoinAndSelect).toHaveBeenCalledWith('task.tags', 'tags');
      expect(mockQb.loadRelationCountAndMap).toHaveBeenCalledWith(
        'task.commentCount',
        'task.comments',
      );
      expect(mockQb.where).toHaveBeenCalledWith('task.id = :id', { id: 1 });
    });

    it('should throw NotFoundException for unknown id', async () => {
      mockQb.getOne.mockResolvedValue(null);

      await expect(service.findOne(999)).rejects.toThrow(NotFoundException);
    });
  });

  // ── findAll with pagination ────────────────────────────────────────
  describe('findAll', () => {
    it('should return paginated results', async () => {
      const mockQb = {
        andWhere: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([
          [{ id: 1, title: 'Task A' }],
          1,
        ]),
      };
      mockTaskRepository.createQueryBuilder.mockReturnValue(mockQb);

      const result = await service.findAll({ page: 1, pageSize: 10 });

      expect(result).toEqual({
        items: [{ id: 1, title: 'Task A' }],
        total: 1,
        page: 1,
      });
      expect(mockQb.skip).toHaveBeenCalledWith(0);
      expect(mockQb.take).toHaveBeenCalledWith(10);
    });

    it('should apply status filter', async () => {
      const mockQb = {
        andWhere: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      };
      mockTaskRepository.createQueryBuilder.mockReturnValue(mockQb);

      await service.findAll({ status: TaskStatus.TODO });

      expect(mockQb.andWhere).toHaveBeenCalledWith(
        'task.status = :status',
        { status: TaskStatus.TODO },
      );
    });
  });

  // ── update — X1: resource ownership check ─────────────────────────
  describe('update', () => {
    it('should throw NotFoundException for unknown task', async () => {
      const mockQb = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        loadRelationCountAndMap: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      };
      mockTaskRepository.createQueryBuilder.mockReturnValue(mockQb);

      await expect(
        service.update(999, { title: 'Updated' }, 1),
      ).rejects.toThrow(NotFoundException);
    });

    it('should allow update by task creator (X1)', async () => {
      const fakeTask = {
        id: 1, title: 'Task 1', creator_id: 5, assignee_id: 2, project_id: 1,
        project: {}, assignee: {}, tags: [], commentCount: 0,
      };
      const updatedTask = { ...fakeTask, title: 'Updated' };

      const mockQb = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        loadRelationCountAndMap: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn()
          .mockResolvedValueOnce(fakeTask)
          .mockResolvedValueOnce(updatedTask),
      };
      mockTaskRepository.createQueryBuilder.mockReturnValue(mockQb);
      mockTaskRepository.save.mockResolvedValue(updatedTask);

      const result = await service.update(1, { title: 'Updated' }, 5); // userId=5 is creator

      expect(result.title).toBe('Updated');
      // Should NOT check membership — creator bypasses
      expect(mockMemberRepository.findOne).not.toHaveBeenCalled();
    });

    it('should allow update by task assignee (X1)', async () => {
      const fakeTask = {
        id: 1, title: 'Task 1', creator_id: 5, assignee_id: 2, project_id: 1,
        project: {}, assignee: {}, tags: [], commentCount: 0,
      };
      const updatedTask = { ...fakeTask, title: 'Updated' };

      const mockQb = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        loadRelationCountAndMap: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn()
          .mockResolvedValueOnce(fakeTask)
          .mockResolvedValueOnce(updatedTask),
      };
      mockTaskRepository.createQueryBuilder.mockReturnValue(mockQb);
      mockTaskRepository.save.mockResolvedValue(updatedTask);

      const result = await service.update(1, { title: 'Updated' }, 2); // userId=2 is assignee

      expect(result.title).toBe('Updated');
      expect(mockMemberRepository.findOne).not.toHaveBeenCalled();
    });

    it('should allow update by project owner (X1)', async () => {
      const fakeTask = {
        id: 1, title: 'Task 1', creator_id: 5, assignee_id: 2, project_id: 1,
        project: {}, assignee: {}, tags: [], commentCount: 0,
      };
      const updatedTask = { ...fakeTask, title: 'Updated' };

      const mockQb = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        loadRelationCountAndMap: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn()
          .mockResolvedValueOnce(fakeTask)
          .mockResolvedValueOnce(updatedTask),
      };
      mockTaskRepository.createQueryBuilder.mockReturnValue(mockQb);
      mockTaskRepository.save.mockResolvedValue(updatedTask);
      mockMemberRepository.findOne.mockResolvedValue({ role: 'owner' });

      // userId=10 is not creator or assignee, but is project owner
      const result = await service.update(1, { title: 'Updated' }, 10);

      expect(result.title).toBe('Updated');
      expect(mockMemberRepository.findOne).toHaveBeenCalledWith({
        where: { user_id: 10, project_id: 1 },
      });
    });

    it('should throw ForbiddenException if non-creator/assignee/owner tries to edit (X1)', async () => {
      const fakeTask = {
        id: 1, title: 'Task 1', creator_id: 5, assignee_id: 2, project_id: 1,
        project: {}, assignee: {}, tags: [], commentCount: 0,
      };

      const mockQb = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        loadRelationCountAndMap: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(fakeTask),
      };
      mockTaskRepository.createQueryBuilder.mockReturnValue(mockQb);
      mockMemberRepository.findOne.mockResolvedValue({ role: 'member' });

      // userId=10 is not creator, not assignee, and is a member (not owner)
      await expect(
        service.update(1, { title: 'Updated' }, 10),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ── remove ─────────────────────────────────────────────────────────
  describe('remove', () => {
    it('should remove a task', async () => {
      const fakeTask = { id: 1 };
      mockTaskRepository.findOneBy.mockResolvedValue(fakeTask);
      mockTaskRepository.remove.mockResolvedValue(fakeTask);

      await service.remove(1);

      expect(mockTaskRepository.remove).toHaveBeenCalledWith(fakeTask);
    });

    it('should throw NotFoundException for unknown id', async () => {
      mockTaskRepository.findOneBy.mockResolvedValue(null);

      await expect(service.remove(999)).rejects.toThrow(NotFoundException);
    });
  });
});
