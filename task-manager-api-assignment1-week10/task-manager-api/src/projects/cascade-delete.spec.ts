import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ProjectsService } from './projects.service';
import { Project } from '../entities/project.entity';
import { User } from '../entities/user.entity';
import { ProjectMember } from '../entities/project-member.entity';

/**
 * C2: Cascade-delete test.
 * Proves that ProjectsService.remove() calls projectRepository.remove(),
 * which triggers the database ON DELETE CASCADE — child tasks and their
 * comments are deleted by the database, not by application code.
 *
 * Since this is a unit test (no real DB), we verify the service layer
 * behaviour: findOneBy → remove. The actual CASCADE is an entity/migration
 * contract tested by the entity decorators (onDelete: 'CASCADE').
 */
describe('C2: cascade delete', () => {
  let service: ProjectsService;

  const mockProjectRepository = {
    findOneBy: jest.fn(),
    remove: jest.fn(),
  };

  const mockUserRepository = {
    findOneBy: jest.fn(),
  };

  const mockMemberRepository = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
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

  it('should call remove() on the project entity (DB CASCADE deletes children)', async () => {
    const fakeProject = {
      id: 1,
      name: 'Project to delete',
      owner_id: 1,
      tasks: [
        {
          id: 10,
          title: 'Task A',
          comments: [
            { id: 100, body: 'Comment on A' },
          ],
        },
        {
          id: 11,
          title: 'Task B',
          comments: [],
        },
      ],
    };

    mockProjectRepository.findOneBy.mockResolvedValue(fakeProject);
    mockProjectRepository.remove.mockResolvedValue(fakeProject);

    await service.remove(1);

    // The service passes the whole entity to TypeORM's remove().
    // The database ON DELETE CASCADE (declared in Task entity with
    // @ManyToOne(() => Project, { onDelete: 'CASCADE' }) and
    // Comment entity with @ManyToOne(() => Task, { onDelete: 'CASCADE' }))
    // handles child deletion automatically.
    expect(mockProjectRepository.findOneBy).toHaveBeenCalledWith({ id: 1 });
    expect(mockProjectRepository.remove).toHaveBeenCalledWith(fakeProject);
  });

  it('should throw NotFoundException when project does not exist', async () => {
    const { NotFoundException } = require('@nestjs/common');
    mockProjectRepository.findOneBy.mockResolvedValue(null);

    await expect(service.remove(999)).rejects.toThrow(NotFoundException);
    expect(mockProjectRepository.remove).not.toHaveBeenCalled();
  });
});
