import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';

/**
 * Layer 1 of the four payment-provider security gates documented in the plan.
 * `PAYMENT_PROVIDER=mock` skips real money, so it must be impossible to ship
 * to production. Crash at startup before Nest even binds the port.
 */
function assertPaymentProviderEnv(): void {
  const provider = (process.env.PAYMENT_PROVIDER ?? 'mock').toLowerCase();
  const nodeEnv = process.env.NODE_ENV;
  if (provider === 'mock' && nodeEnv === 'production') {
    throw new Error('FATAL: PAYMENT_PROVIDER=mock is forbidden in production. Refusing to start.');
  }
}

async function bootstrap() {
  assertPaymentProviderEnv();
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.enableCors({
    origin: process.env['CORS_ORIGINS']?.split(',') ?? ['http://localhost:3000'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-Id'],
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(process.env['PORT'] ?? 3000);
}
void bootstrap();
