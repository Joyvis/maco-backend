import { BadRequestException, Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import {
  PublicAvailabilityRangeSlot,
  PublicAvailabilitySingleSlot,
  SchedulingService,
} from '@scheduling/scheduling.service';
import { Public } from '@tenancy/auth/public.decorator';

import { ShopAvailabilityQueryDto } from './dto/shop-availability-query.dto';
import { ShopProfileDto } from './dto/shop-profile.dto';
import { ShopStaffQueryDto } from './dto/shop-staff-query.dto';
import { ShopService } from './shop.service';

interface PublicQualifiedStaff {
  user_id: string;
  name: string;
}

@Controller('shop')
export class ShopController {
  constructor(
    private readonly shopService: ShopService,
    private readonly schedulingService: SchedulingService,
  ) {}

  @Public()
  @Get(':slug')
  getShop(@Param('slug') slug: string): Promise<ShopProfileDto> {
    return this.shopService.getShopProfile(slug);
  }

  @Public()
  @Get(':slug/services/:serviceId/availability')
  async getAvailability(
    @Param('slug') slug: string,
    @Param('serviceId', new ParseUUIDPipe()) serviceId: string,
    @Query() query: ShopAvailabilityQueryDto,
  ): Promise<{
    data:
      | { mode: 'range'; slots: PublicAvailabilityRangeSlot[] }
      | { mode: 'single'; slot: PublicAvailabilitySingleSlot };
  }> {
    const tenant = await this.schedulingService.resolveTenantBySlug(slug);

    if (query.anchor_at !== undefined || query.offset_minutes !== undefined) {
      if (query.anchor_at === undefined || query.offset_minutes === undefined) {
        throw new BadRequestException('anchor_at and offset_minutes must be provided together');
      }
      const slot = await this.schedulingService.getPublicAvailabilitySingleSlot(
        tenant.id,
        serviceId,
        query.anchor_at,
        Number(query.offset_minutes),
      );
      return { data: { mode: 'single', slot } };
    }

    if (!query.date_from) {
      throw new BadRequestException('date_from is required when no anchor_at is provided');
    }
    const slots = await this.schedulingService.getPublicAvailabilityRange(
      tenant.id,
      serviceId,
      query.date_from,
      query.date_to,
    );
    return { data: { mode: 'range', slots } };
  }

  @Public()
  @Get(':slug/services/:serviceId/staff')
  async getStaff(
    @Param('slug') slug: string,
    @Param('serviceId', new ParseUUIDPipe()) serviceId: string,
    @Query() query: ShopStaffQueryDto,
  ): Promise<{ data: PublicQualifiedStaff[] }> {
    const tenant = await this.schedulingService.resolveTenantBySlug(slug);
    const data = await this.schedulingService.getPublicQualifiedStaff(
      tenant.id,
      serviceId,
      query.slot_start_at,
    );
    return { data: data.map((u) => ({ user_id: u.user_id, name: u.name })) };
  }
}
