import { Logger } from '@nestjs/common';
import { BaseEventHandler } from './base-event-handler';
import { BaseEvent } from './base-event';

class TestEvent extends BaseEvent {
  constructor() {
    super('tenant-uuid', 'TestCommand', 'corr-uuid');
  }
}

class TestEventHandler extends BaseEventHandler<TestEvent> {
  processFn: jest.Mock = jest.fn();

  async process(event: TestEvent): Promise<void> {
    return this.processFn(event);
  }
}

describe('BaseEventHandler', () => {
  let handler: TestEventHandler;
  let event: TestEvent;

  beforeEach(() => {
    handler = new TestEventHandler();
    event = new TestEvent();
    jest.spyOn(handler as any, 'sleep').mockResolvedValue(undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('calls process once when it succeeds', async () => {
    handler.processFn.mockResolvedValue(undefined);
    await handler.handle(event);
    expect(handler.processFn).toHaveBeenCalledTimes(1);
  });

  it('succeeds on second attempt without logging error', async () => {
    const logSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    handler.processFn.mockRejectedValueOnce(new Error('first fail')).mockResolvedValue(undefined);
    await handler.handle(event);
    expect(handler.processFn).toHaveBeenCalledTimes(2);
    expect(logSpy).not.toHaveBeenCalled();
  });

  // AC6
  it('retries 3 times and logs final failure with correlation_id', async () => {
    const logSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    handler.processFn.mockRejectedValue(new Error('persistent error'));

    await handler.handle(event);

    expect(handler.processFn).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
    expect(logSpy).toHaveBeenCalledTimes(1);
    const logCall = logSpy.mock.calls[0];
    expect(logCall[0]).toContain('TestEvent');
    expect(logCall[1]).toMatchObject({
      correlation_id: 'corr-uuid',
      error: 'persistent error',
    });
  });

  it('uses exponential backoff between retries', async () => {
    const sleepSpy = jest.spyOn(handler as any, 'sleep').mockResolvedValue(undefined);
    handler.processFn.mockRejectedValue(new Error('fail'));

    await handler.handle(event);

    expect(sleepSpy).toHaveBeenNthCalledWith(1, 100);
    expect(sleepSpy).toHaveBeenNthCalledWith(2, 200);
    expect(sleepSpy).toHaveBeenNthCalledWith(3, 400);
  });

  it('does not re-throw after final failure', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    handler.processFn.mockRejectedValue(new Error('fail'));
    await expect(handler.handle(event)).resolves.toBeUndefined();
  });

  it('sleep resolves after the specified delay', async () => {
    jest.restoreAllMocks();
    jest.useRealTimers();
    await expect((handler as any).sleep(0)).resolves.toBeUndefined();
  });
});
