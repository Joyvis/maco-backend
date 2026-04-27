import { BaseCommand } from './base-command';

export abstract class BaseCommandHandler<T extends BaseCommand, R = void> {
  abstract execute(command: T): Promise<R>;
}
