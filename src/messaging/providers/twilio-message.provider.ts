import { Injectable, NotImplementedException } from '@nestjs/common';

import { MessageProvider, SendMagicLinkInput } from '../message-provider.interface';

/**
 * Twilio SMS — STUB for the next phase.
 *
 * sendMagicLink will call:
 *   POST https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json
 *   Auth: Basic (TWILIO_ACCOUNT_SID:TWILIO_AUTH_TOKEN)
 *   Body (form-encoded):
 *     From=${TWILIO_FROM_NUMBER}
 *     To=${phoneE164}
 *     Body=`Acesse: ${magicUrl}\nVálido até ${expiresAt}`
 *
 * When filled in, the only place that should change is this file plus env wiring.
 * The rest of the messaging module stays provider-agnostic.
 */
@Injectable()
export class TwilioMessageProvider implements MessageProvider {
  readonly name = 'twilio' as const;

  sendMagicLink(input: SendMagicLinkInput): Promise<void> {
    void input;
    return Promise.reject(
      new NotImplementedException(
        'TwilioMessageProvider.sendMagicLink is not implemented yet — see comments for the Twilio Messages API contract.',
      ),
    );
  }
}
