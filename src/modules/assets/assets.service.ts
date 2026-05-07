import { db } from '../../db/knex.js';

export class AssetService {
  /**
   * Log an activity to the audit trail
   */
  static async logActivity(userId: string, action: string, details: any, assetId?: string, folderId?: string) {
    await db('asset_activity_logs').insert({
      user_id: userId,
      action,
      details,
      asset_id: assetId || null,
      folder_id: folderId || null,
    });
  }

  /**
   * Retrieves folders the user has at least 'view' access to
   */
  static async getAccessibleFolders(userId: string, role: string, parentId?: string) {
    // If admin, they see all
    if (role === 'admin') {
      const q = db('asset_folders');
      if (parentId) q.where({ parent_id: parentId });
      else q.whereNull('parent_id');
      return q.orderBy('name', 'asc');
    }

    /*
      For instructor:
      A folder is accessible if:
      1. They created it
      2. It is public
      3. It was explicitly shared with them
      4. A parent folder was shared with them
    */

    const query = db.withRecursive('ancestors', (qb) => {
      qb.select('id', 'parent_id', 'created_by', 'visibility')
        .from('asset_folders')
        .where((builder) => {
          builder.where('created_by', userId)
                 .orWhere('visibility', 'public')
                 .orWhereExists(function() {
                    this.select('*').from('asset_shares')
                        .whereRaw('asset_shares.folder_id = asset_folders.id')
                        .andWhere('shared_with_user_id', userId)
                        .andWhere(function() {
                          this.whereNull('expires_at').orWhere('expires_at', '>', db.fn.now());
                        });
                 });
        })
      .unionAll((qb) => {
        qb.select('f.id', 'f.parent_id', 'f.created_by', 'f.visibility')
          .from('asset_folders as f')
          .join('ancestors as a', 'f.parent_id', 'a.id');
      });
    })
    .select('f.*')
    .from('asset_folders as f')
    .whereIn('f.id', function() {
      this.select('id').from('ancestors');
    });

    if (parentId) {
      query.andWhere('f.parent_id', parentId);
    } else {
      query.whereNull('f.parent_id');
    }

    return query.orderBy('f.name', 'asc');
  }

  /**
   * Retrieves assets the user has at least 'view' access to
   */
  static async getAccessibleAssets(userId: string, role: string, folderId?: string) {
    if (role === 'admin') {
      const q = db('assets');
      if (folderId) q.where({ folder_id: folderId });
      else q.whereNull('folder_id');
      return q.orderBy('created_at', 'desc');
    }

    /*
      An asset is accessible if:
      1. They created it
      2. It is public
      3. It is explicitly shared with them
      4. It is in a folder (or subfolder of a folder) they have access to
    */

    const folderAccessQuery = db.withRecursive('ancestors', (qb) => {
        qb.select('id', 'parent_id')
          .from('asset_folders')
          .where((builder) => {
            builder.where('created_by', userId)
                   .orWhere('visibility', 'public')
                   .orWhereExists(function() {
                      this.select('*').from('asset_shares')
                          .whereRaw('asset_shares.folder_id = asset_folders.id')
                          .andWhere('shared_with_user_id', userId)
                          .andWhere(function() {
                            this.whereNull('expires_at').orWhere('expires_at', '>', db.fn.now());
                          });
                   });
          })
        .unionAll((qb) => {
          qb.select('f.id', 'f.parent_id')
            .from('asset_folders as f')
            .join('ancestors as a', 'f.parent_id', 'a.id');
        });
      })
      .select('id').from('ancestors');

    const query = db('assets as a')
      .where((builder) => {
        builder.where('a.created_by', userId)
               .orWhere('a.visibility', 'public')
               .orWhereExists(function() {
                 this.select('*').from('asset_shares as ash')
                     .whereRaw('ash.asset_id = a.id')
                     .andWhere('ash.shared_with_user_id', userId)
                     .andWhere(function() {
                       this.whereNull('expires_at').orWhere('expires_at', '>', db.fn.now());
                     });
               })
               .orWhereIn('a.folder_id', folderAccessQuery);
      });

    if (folderId) {
      query.andWhere('a.folder_id', folderId);
    } else {
      query.whereNull('a.folder_id');
    }

    return query.orderBy('a.created_at', 'desc');
  }

  /**
   * Check if a user has a specific permission on an asset or folder
   */
  static async hasPermission(userId: string, role: string, requiredPermission: string, type: 'asset'|'folder', id: string): Promise<boolean> {
    if (role === 'admin') return true;

    if (type === 'folder') {
      const folder = await db('asset_folders').where({ id }).first();
      if (!folder) return false;
      if (folder.created_by === userId) return true;
      if (requiredPermission === 'view' && folder.visibility === 'public') return true;
      if (requiredPermission === 'download' && folder.visibility === 'public') return true;
      
      // Check recursive CTE for folder access
      const access = await db.withRecursive('ancestors', (qb) => {
        qb.select('id', 'parent_id')
          .from('asset_folders')
          .where('id', id)
        .unionAll((qb) => {
          qb.select('f.id', 'f.parent_id')
            .from('asset_folders as f')
            .join('ancestors as a', 'a.parent_id', 'f.id'); // Walk UP the tree
        });
      })
      .select('a.id')
      .from('ancestors as a')
      .whereExists(function() {
         this.select('*').from('asset_shares as ash')
             .whereRaw('ash.folder_id = a.id')
             .andWhere('ash.shared_with_user_id', userId)
             .andWhere('ash.permissions', '@>', JSON.stringify([requiredPermission]))
             .andWhere(function() {
               this.whereNull('expires_at').orWhere('expires_at', '>', db.fn.now());
             });
      }).first();

      return !!access;

    } else {
      const asset = await db('assets').where({ id }).first();
      if (!asset) return false;
      if (asset.created_by === userId) return true;
      if (requiredPermission === 'view' && asset.visibility === 'public') return true;
      if (requiredPermission === 'download' && asset.visibility === 'public') return true;

      // Check direct asset share
      const directShare = await db('asset_shares')
        .where({ asset_id: id, shared_with_user_id: userId })
        .andWhere('permissions', '@>', JSON.stringify([requiredPermission]))
        .andWhere(function() {
            this.whereNull('expires_at').orWhere('expires_at', '>', db.fn.now());
        }).first();
      
      if (directShare) return true;

      // If no direct share and it's in a folder, check folder tree
      if (asset.folder_id) {
         return this.hasPermission(userId, role, requiredPermission, 'folder', asset.folder_id);
      }
      return false;
    }
  }
}
