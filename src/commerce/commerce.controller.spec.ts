import { Test, TestingModule } from '@nestjs/testing';

import { CommerceController } from './commerce.controller';
import { CommerceService } from './commerce.service';

describe('CommerceController', () => {
  let controller: CommerceController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CommerceController],
      providers: [CommerceService],
    }).compile();

    controller = module.get<CommerceController>(CommerceController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
