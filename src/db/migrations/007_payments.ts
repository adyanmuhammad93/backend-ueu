import type { Knex } from 'knex';

/**
 * Migration 007: Payments
 * Converts Supabase migrations 017 + 018 + 020
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('transactions', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.decimal('total_amount', 15, 2).notNullable();
    t.enu('status', ['pending', 'verified', 'rejected']).notNullable().defaultTo('pending');
    t.text('proof_url');
    t.text('notes'); // Admin notes on rejection
    t.timestamps(true, true);
    t.index(['user_id']);
    t.index(['status']);
  });

  await knex.schema.createTable('transaction_items', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('transaction_id').notNullable().references('id').inTable('transactions').onDelete('CASCADE');
    t.uuid('item_id').notNullable();
    t.enu('item_type', ['course', 'bundle']).notNullable();
    t.decimal('price', 15, 2).notNullable();
    t.string('title').notNullable();
    t.index(['transaction_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('transaction_items');
  await knex.schema.dropTableIfExists('transactions');
}
