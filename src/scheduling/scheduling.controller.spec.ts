import { EntityManager } from '@mikro-orm/core';
import { Test, TestingModule } from '@nestjs/testing';

import { SchedulingController } from './scheduling.controller';
import { SchedulingService } from './scheduling.service';

describe('SchedulingController', () => {
  let controller: SchedulingController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SchedulingController],
      providers: [SchedulingService, { provide: EntityManager, useValue: {} }],
    }).compile();

    controller = module.get<SchedulingController>(SchedulingController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
