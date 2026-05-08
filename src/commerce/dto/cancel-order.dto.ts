import { IsString, MaxLength } from 'class-validator';

export class CancelOrderDto {
  @IsString()
  @MaxLength(64)
  reason!: string;
}
