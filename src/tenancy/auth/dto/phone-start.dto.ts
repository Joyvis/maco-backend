import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

export class PhoneStartDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  @Matches(/^[a-z0-9-]+$/, { message: 'tenant_slug must match [a-z0-9-]+' })
  tenant_slug!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  phone!: string;
}
