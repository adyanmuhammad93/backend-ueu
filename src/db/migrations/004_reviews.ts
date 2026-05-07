import type { Knex } from 'knex';

/**
 * Migration 004: Reviews
 * Converts Supabase migrations 009 + 010 + 011
 * Note: Rating auto-update via trigger is handled in the reviewService instead
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('reviews', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.uuid('course_id').notNullable().references('id').inTable('courses').onDelete('CASCADE');
    t.integer('rating').notNullable().checkBetween([1, 5]);
    t.text('comment');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

    t.unique(['user_id', 'course_id']);
    t.index(['course_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('reviews');
}
