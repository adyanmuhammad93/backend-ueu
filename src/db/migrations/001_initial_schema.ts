import type { Knex } from 'knex';

/**
 * Migration 001: Initial Schema
 * Converts Supabase migrations 001 (initial_schema) into a self-hosted structure.
 * Key changes:
 *  - auth.users → public.users table (self-managed with password_hash)
 *  - All RLS policies REMOVED (enforced at the application middleware layer instead)
 *  - Supabase trigger handle_new_user → handled in authService.register() via a DB transaction
 */
export async function up(knex: Knex): Promise<void> {
  // Enable UUID extension
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');

  // USERS TABLE (replaces Supabase auth.users + public.profiles)
  await knex.schema.createTable('users', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.string('email').notNullable().unique();
    t.string('password_hash').notNullable();
    t.string('full_name');
    t.string('avatar_url');
    t.string('gemini_api_key');
    t.enu('role', ['student', 'instructor', 'admin']).notNullable().defaultTo('student');
    t.timestamps(true, true);
  });

  // REFRESH TOKENS TABLE (for JWT rotation strategy)
  await knex.schema.createTable('refresh_tokens', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('token').notNullable().unique();
    t.boolean('revoked').notNullable().defaultTo(false);
    t.timestamp('expires_at').notNullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['user_id']);
    t.index(['token']);
  });

  // CATEGORIES TABLE
  await knex.schema.createTable('categories', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.string('name').notNullable().unique();
    t.string('slug').notNullable().unique();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });

  // COURSES TABLE
  await knex.schema.createTable('courses', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.string('title').notNullable();
    t.string('subtitle');
    t.text('description').notNullable();
    t.uuid('instructor_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('instructor_name').notNullable();
    t.decimal('price', 15, 2).notNullable().defaultTo(0);
    t.string('category').notNullable();
    t.string('thumbnail_url');
    t.enu('level', ['Beginner', 'Intermediate', 'Advanced']).notNullable().defaultTo('Beginner');
    t.string('language');
    t.specificType('learning_objectives', 'text[]').defaultTo('{}');
    t.specificType('requirements', 'text[]').defaultTo('{}');
    t.decimal('rating', 3, 2).notNullable().defaultTo(0);
    t.integer('rating_count').notNullable().defaultTo(0);
    t.boolean('is_published').notNullable().defaultTo(false);
    t.enu('approval_status', ['draft', 'pending', 'approved', 'rejected']).defaultTo('draft');
    t.enu('access_type', ['free', 'paid', 'code', 'prerequisite', 'date', 'capacity', 'approval']).defaultTo('paid');
    t.jsonb('access_config').defaultTo('{}');
    t.jsonb('certificate_config').defaultTo('{}');
    t.timestamps(true, true);

    t.index(['instructor_id']);
    t.index(['is_published']);
    t.index(['approval_status']);
  });

  // ENROLLMENTS TABLE
  await knex.schema.createTable('enrollments', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.uuid('course_id').notNullable().references('id').inTable('courses').onDelete('CASCADE');
    t.enu('status', ['active', 'pending', 'rejected']).notNullable().defaultTo('active');
    t.timestamp('enrolled_at').notNullable().defaultTo(knex.fn.now());

    t.unique(['user_id', 'course_id']);
    t.index(['user_id']);
    t.index(['course_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('enrollments');
  await knex.schema.dropTableIfExists('courses');
  await knex.schema.dropTableIfExists('categories');
  await knex.schema.dropTableIfExists('refresh_tokens');
  await knex.schema.dropTableIfExists('users');
  await knex.raw('DROP EXTENSION IF EXISTS "pgcrypto"');
  await knex.raw('DROP EXTENSION IF EXISTS "uuid-ossp"');
}
