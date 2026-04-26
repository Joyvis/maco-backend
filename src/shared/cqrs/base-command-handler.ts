import { BaseCommand } from "./base-command";

export abstract class BaseCommandHandler<T extends BaseCommand> {
  abstract execute(command: T): Promise<void>;
}
