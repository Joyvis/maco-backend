import { Test, TestingModule } from '@nestjs/testing';
import { Request } from 'express';

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

const makeReq = (overrides: Partial<Request> = {}): Request =>
  ({
    ip: '127.0.0.1',
    headers: { 'user-agent': 'TestAgent/1.0' },
    ...overrides,
  }) as unknown as Request;

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

  it('login: delegates to authService.login with dto, ip, and user-agent', async () => {
    const dto: LoginDto = { email: 'user@test.com', password: 'Password1!' };
    const req = makeReq();
    const result = await controller.login(dto, req);
    expect(authService.login).toHaveBeenCalledWith(dto, '127.0.0.1', 'TestAgent/1.0');
    expect(result).toEqual(mockResponse);
  });

  it('login: passes empty strings when ip and user-agent are absent', async () => {
    const dto: LoginDto = { email: 'user@test.com', password: 'Password1!' };
    const req = makeReq({ ip: undefined, headers: {} });
    await controller.login(dto, req);
    expect(authService.login).toHaveBeenCalledWith(dto, '', '');
  });

  it('refresh: delegates to authService.refresh with the raw token', async () => {
    const dto: RefreshTokenDto = { refresh_token: 'raw-refresh-token' };
    const result = await controller.refresh(dto);
    expect(authService.refresh).toHaveBeenCalledWith('raw-refresh-token');
    expect(result).toEqual(mockResponse);
  });
});
