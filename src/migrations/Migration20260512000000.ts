/* eslint-disable @typescript-eslint/require-await */
import { Migration } from '@mikro-orm/migrations';

export class Migration20260512000000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      alter table "sale_orders"
        add column "booking_channel" varchar(16) null,
        add column "notes" text null;
    `);
  }

  async down(): Promise<void> {
    this.addSql(`
      alter table "sale_orders"
        drop column if exists "booking_channel",
        drop column if exists "notes";
    `);
  }
}
