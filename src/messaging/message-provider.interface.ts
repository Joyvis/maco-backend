export interface SendMagicLinkInput {
  tenantId: string;
  tenantSlug: string;
  phoneE164: string;
  magicUrl: string;
  expiresAt: Date;
}

export interface MessageProvider {
  readonly name: 'mock' | 'twilio';
  sendMagicLink(input: SendMagicLinkInput): Promise<void>;
}

/** DI token for the active provider (resolved by env). */
export const MESSAGE_PROVIDER = Symbol('MESSAGE_PROVIDER');
