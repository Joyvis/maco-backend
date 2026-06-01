import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

// Frontend uses two filter shapes against `GET /users`:
//   - useStaffList:       q[roles_slug_eq]=staff
//   - useCustomerSearch:  role=customer&search=Maria
// We accept both so neither hook needs to be reshaped.
export class ListUsersQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  page_size?: number;

  @IsOptional()
  @IsString()
  role?: string;

  // class-validator/class-transformer can't bind dotted/bracketed query keys
  // to nested DTOs the way Nest's value pipe normalizes them, so the controller
  // pulls `q[roles_slug_eq]` straight off the raw query. This field exists
  // only to document the intended type.
  @IsOptional()
  @IsString()
  'q[roles_slug_eq]'?: string;

  @IsOptional()
  @IsString()
  search?: string;
}
