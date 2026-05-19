import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class ListUsersQueryDto {
  @IsOptional()
  @IsString()
  role?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page_size?: number;
}

export interface UserListItemDto {
  id: string;
  email: string;
  full_name: string;
  name: string;
  phone: string | null;
  roles: string[];
  visit_count: number;
}

export interface ListUsersResponseDto {
  data: UserListItemDto[];
  meta: { total: number; page: number; page_size: number };
}
