export class PermissionDto {
  resource!: string;
  action!: string;
}

export class UserMeDto {
  id!: string;
  email!: string;
  name!: string;
  tenant_id!: string;
  roles!: string[];
  permissions!: PermissionDto[];
}
