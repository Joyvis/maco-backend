export class PermissionDto {
  resource!: string;
  action!: string;
}

export class UserMeDto {
  id!: string;
  email!: string;
  name!: string | null;
  phone!: string | null;
  tenant_id!: string;
  roles!: string[];
  permissions!: PermissionDto[];
}
