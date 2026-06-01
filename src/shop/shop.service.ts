import { computeComboPricing } from '@catalog/combo-pricing.helper';
import { Combo, ComboStatus } from '@catalog/entities/combo.entity';
import { Product, ProductStatus } from '@catalog/entities/product.entity';
import { Service, ServiceStatus } from '@catalog/entities/service.entity';
import { EntityManager } from '@mikro-orm/core';
import { Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@tenancy/entities/role.entity';
import { StaffQualification } from '@tenancy/entities/staff-qualification.entity';
import { Tenant } from '@tenancy/entities/tenant.entity';
import { User, UserState } from '@tenancy/entities/user.entity';

import {
  ShopAddressDto,
  ShopComboDto,
  ShopComboItemDto,
  ShopProductDto,
  ShopProfileDto,
  ShopServiceDto,
  ShopStaffDto,
} from './dto/shop-profile.dto';

const noTenantFilter = (): { filters: { tenant: false } } => ({ filters: { tenant: false } });

@Injectable()
export class ShopService {
  constructor(private readonly em: EntityManager) {}

  async getShopProfile(slug: string): Promise<ShopProfileDto> {
    const tenant = await this.em.findOne(Tenant, { slug }, { filters: false });
    if (!tenant) throw new NotFoundException('Shop not found');

    const allServices = await this.em.find(
      Service,
      { tenant_id: tenant.id, status: ServiceStatus.ACTIVE },
      { populate: ['category'], orderBy: { name: 'asc' }, ...noTenantFilter() },
    );

    // Customer-facing rule: hide services without any qualified staff so they
    // can't be booked from the shop. The catalog-management view keeps showing
    // these — admins need to qualify staff before the service becomes bookable.
    const bookableRows = (await this.em
      .getConnection()
      .execute('select distinct service_id from staff_qualifications where tenant_id = ?', [
        tenant.id,
      ])) as Array<{ service_id: string }>;
    const bookableServiceIds = new Set(bookableRows.map((r) => r.service_id));
    const services = allServices.filter((s) => bookableServiceIds.has(s.id));

    const products = await this.em.find(
      Product,
      { tenant_id: tenant.id, status: ProductStatus.ACTIVE },
      { populate: ['category'], orderBy: { name: 'asc' }, ...noTenantFilter() },
    );

    const combos = await this.em.find(
      Combo,
      { tenant_id: tenant.id, status: ComboStatus.ACTIVE },
      { orderBy: { name: 'asc' }, ...noTenantFilter() },
    );
    if (combos.length > 0) {
      await this.em.populate(combos, ['items.service', 'items.product'], noTenantFilter());
    }

    const staffRole = await this.em.findOne(
      Role,
      { tenant_id: tenant.id, name: 'staff' },
      noTenantFilter(),
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
              noTenantFilter(),
            )
          : [];

      const staffIds = staffUsers.map((u) => u.id);
      const qualifications =
        staffIds.length > 0
          ? await this.em.find(
              StaffQualification,
              { tenant_id: tenant.id, user: { $in: staffIds } },
              { populate: ['service'], ...noTenantFilter() },
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
        name: u.full_name ?? '',
        qualified_services: qualByUser.get(u.id) ?? [],
      }));
    }

    const address = buildAddress(tenant);

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
      combos: combos.map<ShopComboDto>((c) => {
        const pricing = computeComboPricing(c);
        const items: ShopComboItemDto[] = pricing.items.map((i) => ({
          catalog_item_type: i.catalog_item_type,
          catalog_item_id: i.catalog_item_id,
          name: i.name,
          base_price: i.base_price,
          duration_minutes: i.duration_minutes,
          quantity: i.quantity,
        }));
        return {
          id: c.id,
          name: c.name,
          description: c.description,
          discount_type: pricing.discount_type,
          discount_value: pricing.discount_value,
          items,
          total_duration_minutes: pricing.total_duration_minutes,
          subtotal: pricing.subtotal,
          total: pricing.total,
        };
      }),
      products: products.map<ShopProductDto>((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        category: p.category?.name,
        base_price: Number(p.base_price),
        unit: p.unit,
      })),
      ...(address ? { address } : {}),
    };
  }
}

function buildAddress(tenant: Tenant): ShopAddressDto | undefined {
  if (!tenant.address_line1 || !tenant.city || !tenant.state || !tenant.postal_code) {
    return undefined;
  }
  const coordinates =
    tenant.latitude !== undefined && tenant.longitude !== undefined
      ? { lat: Number(tenant.latitude), lng: Number(tenant.longitude) }
      : undefined;
  return {
    line1: tenant.address_line1,
    line2: tenant.address_line2,
    city: tenant.city,
    state: tenant.state,
    postal_code: tenant.postal_code,
    ...(coordinates ? { coordinates } : {}),
  };
}
