import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { CqrsModule } from '@nestjs/cqrs';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { MagicLinkAttempt } from '../entities/magic-link-attempt.entity';
import { MagicLinkRateLimit } from '../entities/magic-link-rate-limit.entity';
import { RefreshToken } from '../entities/refresh-token.entity';
import { Role } from '../entities/role.entity';
import { Tenant } from '../entities/tenant.entity';
import { UserRole } from '../entities/user-role.entity';
import { User } from '../entities/user.entity';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { JwtStrategy } from './jwt.strategy';
import { ProfileCompleteGuard } from './profile-complete.guard';

@Module({
  imports: [
    CqrsModule,
    PassportModule,
    JwtModule.register({}),
    MikroOrmModule.forFeature([
      User,
      UserRole,
      RefreshToken,
      Tenant,
      MagicLinkAttempt,
      MagicLinkRateLimit,
      Role,
    ]),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    // Runs after JwtAuthGuard (declaration order): once the user is
    // authenticated, blocks customers who have not yet set their name.
    {
      provide: APP_GUARD,
      useClass: ProfileCompleteGuard,
    },
  ],
  exports: [AuthService],
})
export class AuthModule {}
