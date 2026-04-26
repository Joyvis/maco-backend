import { Test, TestingModule } from '@nestjs/testing';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthResponseDto } from './dto/auth-response.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';

const mockResponse: AuthResponseDto = {
  access_token: 'access',
  refresh_token: 'refresh',
  token_type: 'Bearer',
  expires_in: 900,
};

describe('AuthController', () => {
  let controller: AuthController;
  let authService: jest.Mocked<Pick<AuthService, 'login' | 'refresh'>>;

  beforeEach(async () => {
    authService = {
      login: jest.fn().mockResolvedValue(mockResponse),
      refresh: jest.fn().mockResolvedValue(mockResponse),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authService }],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('login: delegates to authService.login and returns token pair', async () => {
    const dto: LoginDto = { email: 'user@test.com', password: 'Password1!' };
    const result = await controller.login(dto);
    expect(authService.login).toHaveBeenCalledWith(dto);
    expect(result).toEqual(mockResponse);
  });

  it('refresh: delegates to authService.refresh with the raw token', async () => {
    const dto: RefreshTokenDto = { refresh_token: 'raw-refresh-token' };
    const result = await controller.refresh(dto);
    expect(authService.refresh).toHaveBeenCalledWith('raw-refresh-token');
    expect(result).toEqual(mockResponse);
  });
});
