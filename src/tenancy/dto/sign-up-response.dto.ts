import { TenantStatus } from '../entities/tenant.entity';

export class SignUpResponseDto {
  tenant_id!: string;
  status!: TenantStatus;
  trial_ends_at?: Date;
  checkout_url?: string;
}
