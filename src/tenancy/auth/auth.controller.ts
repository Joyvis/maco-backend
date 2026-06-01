import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { Request } from 'express';

import { AuthService } from './auth.service';
import { AuthResponseDto } from './dto/auth-response.dto';
import { LoginDto } from './dto/login.dto';
import { PhoneStartDto } from './dto/phone-start.dto';
import { PhoneVerifyDto } from './dto/phone-verify.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { Public } from './public.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto, @Req() req: Request): Promise<AuthResponseDto> {
    const ipAddress = req.ip ?? '';
    const userAgent = req.headers['user-agent'] ?? '';
    return this.authService.login(dto, ipAddress, userAgent);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshTokenDto): Promise<AuthResponseDto> {
    return this.authService.refresh(dto.refresh_token);
  }

  @Public()
  @Post('phone/start')
  @HttpCode(200)
  async phoneStart(@Body() dto: PhoneStartDto): Promise<{ status: 'ok' }> {
    await this.authService.startPhoneLogin(dto.tenant_slug, dto.phone);
    return { status: 'ok' };
  }

  @Public()
  @Post('phone/verify')
  @HttpCode(200)
  phoneVerify(@Body() dto: PhoneVerifyDto, @Req() req: Request): Promise<AuthResponseDto> {
    const ipAddress = req.ip ?? '';
    const userAgent = req.headers['user-agent'] ?? '';
    return this.authService.verifyPhoneLogin(dto.token, ipAddress, userAgent);
  }
}
