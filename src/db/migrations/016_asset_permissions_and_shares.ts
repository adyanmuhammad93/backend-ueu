import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Add visibility to asset_folders
  await knex.schema.alterTable('asset_folders', (t) => {
    t.enum('visibility', ['public', 'private']).defaultTo('private').notNullable();
  });

  // Add visibility to assets
  await knex.schema.alterTable('assets', (t) => {
    t.enum('visibility', ['public', 'private']).defaultTo('private').notNullable();
  });

  // Create asset_shares table
  await knex.schema.createTable('asset_shares', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('asset_id').references('id').inTable('assets').onDelete('CASCADE').nullable();
    t.uuid('folder_id').references('id').inTable('asset_folders').onDelete('CASCADE').nullable();
    t.uuid('shared_with_user_id').references('id').inTable('users').onDelete('CASCADE').notNullable();
    t.uuid('shared_by_user_id').references('id').inTable('users').onDelete('CASCADE').notNullable();
    t.jsonb('permissions').notNullable().defaultTo('["view"]'); // array of strings: 'view', 'edit', 'delete', 'share', 'download'
    t.timestamp('expires_at').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    // Indexes for fast lookups
    t.index(['asset_id', 'shared_with_user_id']);
    t.index(['folder_id', 'shared_with_user_id']);
  });

  // Create asset_activity_logs table
  await knex.schema.createTable('asset_activity_logs', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('asset_id').references('id').inTable('assets').onDelete('CASCADE').nullable();
    t.uuid('folder_id').references('id').inTable('asset_folders').onDelete('CASCADE').nullable();
    t.uuid('user_id').references('id').inTable('users').onDelete('CASCADE').notNullable();
    t.string('action').notNullable(); // 'visibility_changed', 'shared', 'share_revoked', 'permission_updated', etc.
    t.jsonb('details').nullable(); // snapshot of changes
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

    // Indexes
    t.index(['asset_id']);
    t.index(['folder_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('asset_activity_logs');
  await knex.schema.dropTableIfExists('asset_shares');
  
  await knex.schema.alterTable('assets', (t) => {
    t.dropColumn('visibility');
  });

  await knex.schema.alterTable('asset_folders', (t) => {
    t.dropColumn('visibility');
  });
}
