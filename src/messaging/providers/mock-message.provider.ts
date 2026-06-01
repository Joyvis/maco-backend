import { Injectable, Logger } from '@nestjs/common';

import { MessageProvider, SendMagicLinkInput } from '../message-provider.interface';

@Injectable()
export class MockMessageProvider implements MessageProvider {
  readonly name = 'mock' as const;
  private readonly logger = new Logger(MockMessageProvider.name);

  sendMagicLink(input: SendMagicLinkInput): Promise<void> {
    this.logger.log(
      `[mock-message] tenant=${input.tenantSlug} phone=${input.phoneE164}\n` +
        `               magic=${input.magicUrl}\n` +
        `               expires=${input.expiresAt.toISOString()}`,
    );
    return Promise.resolve();
  }
}
