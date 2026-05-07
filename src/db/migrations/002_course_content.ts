import type { Knex } from 'knex';

/**
 * Migration 002: Course Content
 * Converts Supabase migrations 002 (modules, lessons) + 003 (is_published) + 005 (course details)
 */
export async function up(knex: Knex): Promise<void> {
  // MODULES TABLE
  await knex.schema.createTable('modules', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('course_id').notNullable().references('id').inTable('courses').onDelete('CASCADE');
    t.string('title').notNullable();
    t.integer('order_index').notNullable().defaultTo(0);
    t.jsonb('prerequisites').defaultTo('[]');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['course_id']);
  });

  // LESSONS TABLE
  await knex.schema.createTable('lessons', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('module_id').notNullable().references('id').inTable('modules').onDelete('CASCADE');
    t.string('title').notNullable();
    t.enu('type', ['video', 'article', 'quiz', 'assignment']).notNullable().defaultTo('video');
    t.text('content');
    t.text('video_url');
    t.string('duration').defaultTo('0:00');
    t.boolean('is_published').notNullable().defaultTo(false);
    t.integer('order_index').notNullable().defaultTo(0);
    t.jsonb('prerequisites').defaultTo('[]');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['module_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('lessons');
  await knex.schema.dropTableIfExists('modules');
}
