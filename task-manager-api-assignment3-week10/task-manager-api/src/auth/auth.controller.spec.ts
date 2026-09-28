import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

const mockAuthService = () => ({
  register: jest.fn(),
  login: jest.fn(),
  refresh: jest.fn(),
  logout: jest.fn(),
});

describe('AuthController', () => {
  let controller: AuthController;
  let service: ReturnType<typeof mockAuthService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useFactory: mockAuthService }],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    service = module.get(AuthService) as unknown as ReturnType<typeof mockAuthService>;
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('POST /auth/register', () => {
    it('should call authService.register and return result', async () => {
      const dto = { name: 'Alice', email: 'alice@example.com', password: 'pass1234' };
      const expected = { id: 1, name: 'Alice', email: 'alice@example.com', created_at: new Date() };
      service.register.mockResolvedValue(expected);

      const result = await controller.register(dto);

      expect(service.register).toHaveBeenCalledWith(dto);
      expect(result).toEqual(expected);
    });
  });

  describe('POST /auth/login', () => {
    it('should call authService.login and return tokens', async () => {
      const dto = { email: 'alice@example.com', password: 'pass1234' };
      const expected = { access_token: 'jwt', refresh_token: 'rt' };
      service.login.mockResolvedValue(expected);

      const result = await controller.login(dto);

      expect(service.login).toHaveBeenCalledWith(dto);
      expect(result).toEqual(expected);
    });
  });

  describe('POST /auth/refresh', () => {
    it('should call authService.refresh with the token', async () => {
      const dto = { refresh_token: 'raw-token' };
      const expected = { access_token: 'new-jwt', refresh_token: 'new-rt' };
      service.refresh.mockResolvedValue(expected);

      const result = await controller.refresh(dto);

      expect(service.refresh).toHaveBeenCalledWith('raw-token');
      expect(result).toEqual(expected);
    });
  });

  describe('POST /auth/logout', () => {
    it('should call authService.logout with the token', async () => {
      service.logout.mockResolvedValue(undefined);

      await controller.logout({ refresh_token: 'raw-token' });

      expect(service.logout).toHaveBeenCalledWith('raw-token');
    });
  });
});
