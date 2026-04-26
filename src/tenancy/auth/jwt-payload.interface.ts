export interface JwtPayload {
  sub: string;
  tenant_id: string;
  roles: string[];
  iat?: number;
  exp?: number;
}

export interface RequestUser {
  id: string;
  tenantId: string;
  roles: string[];
}
