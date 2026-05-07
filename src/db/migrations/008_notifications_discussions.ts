import type { Knex } from 'knex';

/**
 * Migration 008: Notifications & Discussions
 * Converts Supabase migrations 021 + 022 + 023 + 024
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('notifications', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('title').notNullable();
    t.text('message').notNullable();
    t.enu('type', ['info', 'success', 'warning', 'error']).notNullable().defaultTo('info');
    t.boolean('is_read').notNullable().defaultTo(false);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['user_id', 'is_read']);
  });

  await knex.schema.createTable('comments', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.uuid('lesson_id').notNullable().references('id').inTable('lessons').onDelete('CASCADE');
    t.uuid('parent_id').references('id').inTable('comments').onDelete('CASCADE');
    t.text('content').notNullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['lesson_id']);
    t.index(['parent_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('comments');
  await knex.schema.dropTableIfExists('notifications');
}
