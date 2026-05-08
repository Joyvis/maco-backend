import { Controller, Get, Param } from '@nestjs/common';
import { Public } from '@tenancy/auth/public.decorator';

import { ShopProfileDto } from './dto/shop-profile.dto';
import { ShopService } from './shop.service';

@Controller('shop')
export class ShopController {
  constructor(private readonly shopService: ShopService) {}

  @Public()
  @Get(':slug')
  getShop(@Param('slug') slug: string): Promise<ShopProfileDto> {
    return this.shopService.getShopProfile(slug);
  }
}
