import { Migrator } from '@mikro-orm/migrations';
import { PostgreSqlDriver } from '@mikro-orm/postgresql';
import { UnderscoreNamingStrategy, defineConfig } from '@mikro-orm/core';

export default defineConfig({
  driver: PostgreSqlDriver,
  host: process.env.DATABASE_HOST ?? 'localhost',
  port: parseInt(process.env.DATABASE_PORT ?? '5432', 10),
  dbName: process.env.DATABASE_NAME ?? 'maco',
  user: process.env.DATABASE_USER ?? 'maco',
  password: process.env.DATABASE_PASSWORD ?? 'maco',
  entities: ['dist/**/*.entity.js'],
  entitiesTs: ['src/**/*.entity.ts'],
  namingStrategy: UnderscoreNamingStrategy,
  debug: process.env.MIKRO_ORM_DEBUG === 'true',
  migrations: {
    path: 'dist/migrations',
    pathTs: 'src/migrations',
  },
  extensions: [Migrator],
});
