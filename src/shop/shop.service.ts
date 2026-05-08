import { Service, ServiceStatus } from '@catalog/entities/service.entity';
import { EntityManager } from '@mikro-orm/core';
import { Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@tenancy/entities/role.entity';
import { StaffQualification } from '@tenancy/entities/staff-qualification.entity';
import { Tenant } from '@tenancy/entities/tenant.entity';
import { User, UserState } from '@tenancy/entities/user.entity';

import { ShopProfileDto, ShopServiceDto, ShopStaffDto } from './dto/shop-profile.dto';

const NO_TENANT_FILTER = { filters: { tenant: false } } as const;

@Injectable()
export class ShopService {
  constructor(private readonly em: EntityManager) {}

  async getShopProfile(slug: string): Promise<ShopProfileDto> {
    const tenant = await this.em.findOne(Tenant, { slug }, { filters: false });
    if (!tenant) throw new NotFoundException('Shop not found');

    const services = await this.em.find(
      Service,
      { tenant_id: tenant.id, status: ServiceStatus.ACTIVE },
      { populate: ['category'], orderBy: { name: 'asc' }, ...NO_TENANT_FILTER },
    );

    const staffRole = await this.em.findOne(
      Role,
      { tenant_id: tenant.id, name: 'staff' },
      NO_TENANT_FILTER,
    );

    let staff: ShopStaffDto[] = [];
    if (staffRole) {
      const rows = (await this.em
        .getConnection()
        .execute(`select user_id from user_roles where role_id = ?`, [staffRole.id])) as Array<{
        user_id: string;
      }>;
      const userIds = rows.map((r) => r.user_id);
      const staffUsers =
        userIds.length > 0
          ? await this.em.find(
              User,
              { id: { $in: userIds }, tenant_id: tenant.id, state: UserState.ACTIVE },
              NO_TENANT_FILTER,
            )
          : [];

      const staffIds = staffUsers.map((u) => u.id);
      const qualifications =
        staffIds.length > 0
          ? await this.em.find(
              StaffQualification,
              { tenant_id: tenant.id, user: { $in: staffIds } },
              { populate: ['service'], ...NO_TENANT_FILTER },
            )
          : [];
      const qualByUser = new Map<string, { id: string; name: string }[]>();
      for (const q of qualifications) {
        const list = qualByUser.get(q.user.id) ?? [];
        list.push({ id: q.service.id, name: q.service.name });
        qualByUser.set(q.user.id, list);
      }

      staff = staffUsers.map<ShopStaffDto>((u) => ({
        user_id: u.id,
        name: u.full_name,
        qualified_services: qualByUser.get(u.id) ?? [],
      }));
    }

    return {
      slug: tenant.slug ?? slug,
      name: tenant.name,
      logo_url: tenant.logo_url,
      city: tenant.city,
      rating: tenant.rating !== undefined ? Number(tenant.rating) : undefined,
      services: services.map<ShopServiceDto>((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        category: s.category?.name,
        duration_minutes: s.duration_minutes,
        base_price: Number(s.base_price),
      })),
      staff,
    };
  }
}
