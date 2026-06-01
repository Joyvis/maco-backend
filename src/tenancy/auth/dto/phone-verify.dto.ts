import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class PhoneVerifyDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(16)
  @MaxLength(64)
  token!: string;
}
