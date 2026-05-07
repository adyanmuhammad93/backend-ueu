import type { Knex } from 'knex';

/**
 * Migration 010: Assets Repository & Course Assignments
 * Converts Supabase migrations 036 + 037
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('asset_folders', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.string('name').notNullable();
    t.uuid('parent_id').references('id').inTable('asset_folders').onDelete('CASCADE');
    t.uuid('created_by').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['created_by']);
    t.index(['parent_id']);
  });

  await knex.schema.createTable('assets', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('folder_id').references('id').inTable('asset_folders').onDelete('SET NULL');
    t.string('name').notNullable();
    t.string('file_url').notNullable();
    t.string('file_type');
    t.bigInteger('file_size');
    t.uuid('created_by').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['created_by']);
    t.index(['folder_id']);
  });

  // Settings table (replaces Supabase app_settings)
  await knex.schema.createTable('settings', (t) => {
    t.string('key').primary();
    t.jsonb('value').notNullable().defaultTo('{}');
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });

  // Course assignments (admin assigning instructors to courses)
  await knex.schema.createTable('course_assignments', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('course_id').notNullable().references('id').inTable('courses').onDelete('CASCADE');
    t.uuid('instructor_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.uuid('assigned_by').references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

    t.unique(['course_id', 'instructor_id']);
    t.index(['instructor_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('course_assignments');
  await knex.schema.dropTableIfExists('settings');
  await knex.schema.dropTableIfExists('assets');
  await knex.schema.dropTableIfExists('asset_folders');
}
