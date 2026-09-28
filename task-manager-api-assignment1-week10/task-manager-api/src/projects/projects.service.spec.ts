import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { Project } from '../entities/project.entity';
import { User } from '../entities/user.entity';
import { ProjectMember } from '../entities/project-member.entity';

/**
 * C3 + X1: Unit tests for ProjectsService.
 * Updated for Assignment 2 — create() now takes (dto, userId).
 */
describe('ProjectsService', () => {
  let service: ProjectsService;

  // ── Mock repositories ──────────────────────────────────────────────
  const mockProjectRepository = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    findOneBy: jest.fn(),
    findAndCount: jest.fn(),
    remove: jest.fn(),
  };

  const mockUserRepository = {
    findOneBy: jest.fn(),
  };

  const mockMemberRepository = {
    create: jest.fn(),
    save: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectsService,
        { provide: getRepositoryToken(Project), useValue: mockProjectRepository },
        { provide: getRepositoryToken(User), useValue: mockUserRepository },
        { provide: getRepositoryToken(ProjectMember), useValue: mockMemberRepository },
      ],
    }).compile();

    service = module.get<ProjectsService>(ProjectsService);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ══════════════════════════════════════════════════════════════════
  //  create — W2: userId from @CurrentUser, auto-create membership
  // ══════════════════════════════════════════════════════════════════
  describe('create', () => {
    it('should throw NotFoundException when userId (owner) does not exist', async () => {
      mockUserRepository.findOneBy.mockResolvedValue(null);

      await expect(
        service.create({ name: 'My Project' }, 999),
      ).rejects.toThrow(NotFoundException);

      expect(mockUserRepository.findOneBy).toHaveBeenCalledWith({ id: 999 });
    });

    it('should create a project, auto-create owner membership, and return with owner relation (X1)', async () => {
      const fakeOwner = { id: 1, name: 'Alice', email: 'alice@test.com' };
      const fakeSaved = { id: 10, name: 'Alpha', owner_id: 1, created_at: new Date() };
      const fakeFullProject = { ...fakeSaved, owner: fakeOwner };
      const fakeMembership = { user_id: 1, project_id: 10, role: 'owner' };

      mockUserRepository.findOneBy.mockResolvedValue(fakeOwner);
      mockProjectRepository.create.mockReturnValue(fakeSaved);
      mockProjectRepository.save.mockResolvedValue(fakeSaved);
      mockMemberRepository.create.mockReturnValue(fakeMembership);
      mockMemberRepository.save.mockResolvedValue(fakeMembership);
      mockProjectRepository.findOne.mockResolvedValue(fakeFullProject);

      const result = await service.create({ name: 'Alpha' }, 1);

      // X1: field-by-field mapping assertion
      expect(result.id).toBe(10);
      expect(result.name).toBe('Alpha');
      expect(result.owner_id).toBe(1);
      expect(result.owner).toEqual(fakeOwner);
      expect(mockProjectRepository.create).toHaveBeenCalledWith({
        name: 'Alpha',
        owner_id: 1,
      });
      expect(mockProjectRepository.save).toHaveBeenCalled();
      // Verify auto-created membership
      expect(mockMemberRepository.create).toHaveBeenCalledWith({
        user_id: 1,
        project_id: 10,
        role: 'owner',
      });
      expect(mockMemberRepository.save).toHaveBeenCalled();
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  findOne
  // ══════════════════════════════════════════════════════════════════
  describe('findOne', () => {
    it('should return a project with owner relation (X1)', async () => {
      const fakeProject = {
        id: 1,
        name: 'Beta',
        owner_id: 2,
        created_at: new Date(),
        owner: { id: 2, name: 'Bob' },
      };
      mockProjectRepository.findOne.mockResolvedValue(fakeProject);

      const result = await service.findOne(1);

      expect(result.id).toBe(1);
      expect(result.name).toBe('Beta');
      expect(result.owner.id).toBe(2);
      expect(mockProjectRepository.findOne).toHaveBeenCalledWith({
        where: { id: 1 },
        relations: ['owner'],
      });
    });

    it('should throw NotFoundException for unknown id', async () => {
      mockProjectRepository.findOne.mockResolvedValue(null);

      await expect(service.findOne(999)).rejects.toThrow(NotFoundException);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  findAll — pagination
  // ══════════════════════════════════════════════════════════════════
  describe('findAll', () => {
    it('should return paginated results with defaults', async () => {
      const fakeProjects = [
        { id: 1, name: 'A', owner: {} },
        { id: 2, name: 'B', owner: {} },
      ];
      mockProjectRepository.findAndCount.mockResolvedValue([fakeProjects, 2]);

      const result = await service.findAll({});

      expect(result.items).toEqual(fakeProjects);
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(mockProjectRepository.findAndCount).toHaveBeenCalledWith({
        relations: ['owner'],
        skip: 0,
        take: 20,
        order: { created_at: 'DESC' },
      });
    });

    it('should respect page and pageSize', async () => {
      mockProjectRepository.findAndCount.mockResolvedValue([[], 0]);

      await service.findAll({ page: 3, pageSize: 5 });

      expect(mockProjectRepository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 10, // (3 - 1) * 5
          take: 5,
        }),
      );
    });

    it('should cap pageSize at 100', async () => {
      mockProjectRepository.findAndCount.mockResolvedValue([[], 0]);

      await service.findAll({ pageSize: 999 });

      expect(mockProjectRepository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 }),
      );
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  update
  // ══════════════════════════════════════════════════════════════════
  describe('update', () => {
    it('should throw NotFoundException for unknown project', async () => {
      mockProjectRepository.findOne.mockResolvedValue(null);

      await expect(
        service.update(999, { name: 'Updated' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should partially update name only', async () => {
      const existing = {
        id: 1,
        name: 'Old',
        owner_id: 1,
        owner: { id: 1 },
      };
      const updated = { ...existing, name: 'New' };

      mockProjectRepository.findOne
        .mockResolvedValueOnce(existing)  // first findOne in update()
        .mockResolvedValueOnce(updated);  // second findOne to return
      mockProjectRepository.save.mockResolvedValue(updated);

      const result = await service.update(1, { name: 'New' });

      expect(result.name).toBe('New');
    });

    it('should validate new ownerId if provided', async () => {
      const existing = { id: 1, name: 'P', owner_id: 1, owner: { id: 1 } };
      mockProjectRepository.findOne.mockResolvedValue(existing);
      mockUserRepository.findOneBy.mockResolvedValue(null);

      await expect(
        service.update(1, { ownerId: 999 }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  remove — C2: cascade
  // ══════════════════════════════════════════════════════════════════
  describe('remove', () => {
    it('should remove a project', async () => {
      const fakeProject = { id: 1 };
      mockProjectRepository.findOneBy.mockResolvedValue(fakeProject);
      mockProjectRepository.remove.mockResolvedValue(fakeProject);

      await service.remove(1);

      expect(mockProjectRepository.remove).toHaveBeenCalledWith(fakeProject);
    });

    it('should throw NotFoundException for unknown id', async () => {
      mockProjectRepository.findOneBy.mockResolvedValue(null);

      await expect(service.remove(999)).rejects.toThrow(NotFoundException);
    });
  });
});
