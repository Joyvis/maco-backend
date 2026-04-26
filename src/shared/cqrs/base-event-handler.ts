import { Logger } from "@nestjs/common";
import { IEventHandler } from "@nestjs/cqrs";
import { BaseEvent } from "./base-event";

const BACKOFF_MS = [100, 200, 400] as const;
const MAX_RETRIES = 3;

export abstract class BaseEventHandler<
  T extends BaseEvent,
> implements IEventHandler<T> {
  protected readonly logger = new Logger(this.constructor.name);

  async handle(event: T): Promise<void> {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        await this.process(event);
        return;
      } catch (err) {
        if (attempt < MAX_RETRIES) {
          await this.sleep(BACKOFF_MS[attempt]);
        } else {
          this.logger.error(
            `Event handler failed after ${MAX_RETRIES} retries: ${event.constructor.name}`,
            {
              correlation_id: event.correlation_id,
              event: event.constructor.name,
              error: err instanceof Error ? err.message : String(err),
            },
          );
        }
      }
    }
  }

  abstract process(event: T): Promise<void>;

  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
