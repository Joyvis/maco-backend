import { CommandBus } from '@nestjs/cqrs';
import { Test, TestingModule } from '@nestjs/testing';

import { TenancyController } from './tenancy.controller';
import { TenancyService } from './tenancy.service';

describe('TenancyController', () => {
  let controller: TenancyController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TenancyController],
      providers: [TenancyService, { provide: CommandBus, useValue: { execute: jest.fn() } }],
    }).compile();

    controller = module.get<TenancyController>(TenancyController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
