import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { SchedulingService } from '@scheduling/scheduling.service';

import { ShopProfileDto } from './dto/shop-profile.dto';
import { ShopController } from './shop.controller';
import { ShopService } from './shop.service';

type GetShopProfileMock = jest.Mock<Promise<ShopProfileDto>, [string]>;

describe('ShopController', () => {
  let controller: ShopController;
  let getShopProfile: GetShopProfileMock;

  beforeEach(async () => {
    getShopProfile = jest.fn() as GetShopProfileMock;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ShopController],
      providers: [
        { provide: ShopService, useValue: { getShopProfile } },
        { provide: SchedulingService, useValue: {} },
      ],
    }).compile();

    controller = module.get<ShopController>(ShopController);
  });

  it('returns the shop profile for a known slug', async () => {
    const profile: ShopProfileDto = {
      slug: 'salao-da-maria',
      name: 'Salão da Maria',
      city: 'São Paulo',
      rating: 4.8,
      services: [
        {
          id: 's1',
          name: 'Corte',
          category: 'Cabelo',
          duration_minutes: 30,
          base_price: 50,
        },
      ],
      staff: [{ user_id: 'u1', name: 'Maria', qualified_services: [] }],
      combos: [],
      products: [],
    };
    getShopProfile.mockResolvedValue(profile);

    const result = await controller.getShop('salao-da-maria');

    expect(result).toEqual(profile);
    expect(getShopProfile).toHaveBeenCalledWith('salao-da-maria');
  });

  it('propagates NotFoundException for an unknown slug', async () => {
    getShopProfile.mockRejectedValue(new NotFoundException('Shop not found'));

    await expect(controller.getShop('missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});
