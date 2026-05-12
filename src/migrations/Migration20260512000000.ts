/* eslint-disable @typescript-eslint/require-await */
import { Migration } from '@mikro-orm/migrations';

export class Migration20260512000000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`create type "booking_channel" as enum ('app', 'walk_in', 'phone', 'whatsapp');`);

    this.addSql(`
      alter table "sale_orders"
        add column "booking_channel" "booking_channel" null,
        add column "notes" text null;
    `);
  }

  async down(): Promise<void> {
    this.addSql(`
      alter table "sale_orders"
        drop column if exists "booking_channel",
        drop column if exists "notes";
    `);

    this.addSql(`drop type if exists "booking_channel";`);
  }
}
