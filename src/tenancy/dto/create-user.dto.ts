import {
  IsArray,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export enum UserRoleType {
  OWNER = 'owner',
  TA = 'ta',
  STAFF = 'staff',
  CUSTOMER = 'customer',
}

export class CreateUserDto {
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  full_name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @IsOptional()
  @IsArray()
  @IsEnum(UserRoleType, { each: true })
  initial_roles?: UserRoleType[];
}
