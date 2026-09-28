import { LoggerService } from './logger.service';

describe('LoggerService (X3 — module scope)', () => {
  let service: LoggerService;

  beforeEach(() => {
    service = new LoggerService();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should format and return a log message', () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

    const result = service.log('TestContext', 'Hello world');

    expect(result).toContain('[TestContext] Hello world');
    expect(consoleSpy).toHaveBeenCalledTimes(1);

    consoleSpy.mockRestore();
  });
});
