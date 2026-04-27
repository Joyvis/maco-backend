import { IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

import { AccountType, SubscriptionType } from '../entities/tenant.entity';

export class SignUpDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;

  @IsString()
  @IsNotEmpty()
  full_name!: string;

  @IsEnum(AccountType)
  account_type!: AccountType;

  @IsOptional()
  @IsUUID()
  parent_tenant_id?: string;

  @IsUUID()
  plan_id!: string;

  @IsEnum(SubscriptionType)
  subscription_type!: SubscriptionType;
}
