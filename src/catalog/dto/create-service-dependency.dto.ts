import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

export class CreateServiceDependencyDto {
  @IsUUID()
  depends_on_service_id!: string;

  @IsOptional()
  @IsBoolean()
  auto_include?: boolean;
}
