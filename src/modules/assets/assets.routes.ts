import { db } from '../../db/knex.js';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authenticate, requireRole } from '../../middleware/authenticate.js';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../../config/env.js';
import { AssetService } from './assets.service.js';

export async function assetRoutes(app: FastifyInstance) {
  // GET /api/assets?folderId=
  app.get('/', { preHandler: [authenticate, requireRole('instructor', 'admin')] }, async (request, reply) => {
    const user = (request as any).user;
    const { folderId } = request.query as any;
    
    // Check if user has access to the requested folder
    if (folderId) {
       const hasAccess = await AssetService.hasPermission(user.id, user.role, 'view', 'folder', folderId);
       if (!hasAccess) return reply.status(403).send({ error: 'Folder access denied' });
    }

    const query = await AssetService.getAccessibleAssets(user.id, user.role, folderId);
    return reply.send({ assets: query });
  });

  // GET /api/assets/folders?parentId=
  app.get('/folders', { preHandler: [authenticate, requireRole('instructor', 'admin')] }, async (request, reply) => {
    const user = (request as any).user;
    const { parentId } = request.query as any;

    if (parentId) {
       const hasAccess = await AssetService.hasPermission(user.id, user.role, 'view', 'folder', parentId);
       if (!hasAccess) return reply.status(403).send({ error: 'Parent folder access denied' });
    }

    const query = await AssetService.getAccessibleFolders(user.id, user.role, parentId);
    return reply.send({ folders: query });
  });

  // POST /api/assets/folders
  app.post('/folders', { preHandler: [authenticate, requireRole('instructor', 'admin')] }, async (request, reply) => {
    const user = (request as any).user;
    const { name, parentId } = request.body as any;

    if (parentId) {
      const hasAccess = await AssetService.hasPermission(user.id, user.role, 'edit', 'folder', parentId);
      if (!hasAccess) return reply.status(403).send({ error: 'Parent folder access denied' });
    }

    const [folder] = await db('asset_folders')
      .insert({ name, parent_id: parentId || null, created_by: user.id, visibility: 'private' })
      .returning('*');
      
    await AssetService.logActivity(user.id, 'folder_created', { name, parentId }, undefined, folder.id);
    return reply.status(201).send({ folder });
  });

  // PATCH /api/assets/folders/:id
  app.patch('/folders/:id', { preHandler: [authenticate, requireRole('instructor', 'admin')] }, async (request, reply) => {
    const user = (request as any).user;
    const { id } = request.params as { id: string };
    const { name } = request.body as any;
    
    const hasAccess = await AssetService.hasPermission(user.id, user.role, 'edit', 'folder', id);
    if (!hasAccess) return reply.status(403).send({ error: 'Folder access denied' });

    const [folder] = await db('asset_folders').where({ id }).update({ name }).returning('*');
    await AssetService.logActivity(user.id, 'folder_renamed', { oldName: folder.name, newName: name }, undefined, id);
    return reply.send({ folder });
  });

  // DELETE /api/assets/folders/:id
  app.delete('/folders/:id', { preHandler: [authenticate, requireRole('instructor', 'admin')] }, async (request, reply) => {
    const user = (request as any).user;
    const { id } = request.params as { id: string };
    
    const hasAccess = await AssetService.hasPermission(user.id, user.role, 'delete', 'folder', id);
    if (!hasAccess) return reply.status(403).send({ error: 'Folder access denied' });

    await db('asset_folders').where({ id }).delete();
    await AssetService.logActivity(user.id, 'folder_deleted', null, undefined, id);
    return reply.status(204).send();
  });

  // POST /api/assets/upload — file upload (multipart)
  app.post('/upload', { preHandler: [authenticate] }, async (request, reply) => {
    const user = (request as any).user;
    const data = await request.file();
    if (!data) return reply.status(400).send({ error: 'No file uploaded' });

    const allowedExts = ['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.mp4', '.webm', '.png', '.jpg', '.jpeg', '.gif', '.zip', '.mp3', '.wav'];
    const ext = path.extname(data.filename).toLowerCase();
    if (!allowedExts.includes(ext)) {
      return reply.status(400).send({ error: `File type ${ext} not allowed` });
    }

    const fileName = `${uuidv4()}${ext}`;
    const uploadDir = path.resolve(config.storage.uploadDir);
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

    const filePath = path.join(uploadDir, fileName);
    await fs.promises.writeFile(filePath, await data.toBuffer());

    const fileUrl = `/assets?bucket=local&file=${fileName}`;
    const folderId = (data.fields.folderId as any)?.value || null;

    if (folderId) {
      const hasAccess = await AssetService.hasPermission(user.id, user.role, 'edit', 'folder', folderId);
      if (!hasAccess) return reply.status(403).send({ error: 'Folder upload access denied' });
    }

    const [asset] = await db('assets').insert({
      name: data.filename,
      file_url: fileUrl,
      file_type: ext.slice(1),
      file_size: (await fs.promises.stat(filePath)).size,
      folder_id: folderId,
      created_by: user.id,
      visibility: 'private'
    }).returning('*');

    await AssetService.logActivity(user.id, 'asset_uploaded', { fileName: data.filename, folderId }, asset.id);

    return reply.status(201).send({ asset });
  });

  // PATCH /api/assets/:id
  app.patch('/:id', { preHandler: [authenticate, requireRole('instructor', 'admin')] }, async (request, reply) => {
    const user = (request as any).user;
    const { id } = request.params as { id: string };
    const { name } = request.body as any;
    
    const hasAccess = await AssetService.hasPermission(user.id, user.role, 'edit', 'asset', id);
    if (!hasAccess) return reply.status(403).send({ error: 'Asset access denied' });

    const [asset] = await db('assets').where({ id }).update({ name }).returning('*');
    await AssetService.logActivity(user.id, 'asset_renamed', { newName: name }, id);
    return reply.send({ asset });
  });

  // DELETE /api/assets/:id
  app.delete('/:id', { preHandler: [authenticate, requireRole('instructor', 'admin')] }, async (request, reply) => {
    const user = (request as any).user;
    const { id } = request.params as { id: string };
    
    const hasAccess = await AssetService.hasPermission(user.id, user.role, 'delete', 'asset', id);
    if (!hasAccess) return reply.status(403).send({ error: 'Asset access denied' });

    await db('assets').where({ id }).delete();
    await AssetService.logActivity(user.id, 'asset_deleted', null, id);
    return reply.status(204).send();
  });

  // --- NEW ROUTES FOR SHARING & VISIBILITY ---

  // GET /api/assets/admin/shares (Global list for Admin Matrix)
  app.get('/admin/shares', { preHandler: [authenticate, requireRole('admin')] }, async (request, reply) => {
    const shares = await db('asset_shares')
      .leftJoin('users as shared_with', 'shared_with.id', 'asset_shares.shared_with_user_id')
      .leftJoin('users as shared_by', 'shared_by.id', 'asset_shares.shared_by_user_id')
      .leftJoin('assets', 'assets.id', 'asset_shares.asset_id')
      .leftJoin('asset_folders', 'asset_folders.id', 'asset_shares.folder_id')
      .select(
        'asset_shares.*',
        'shared_with.email as shared_with_email',
        'shared_with.full_name as shared_with_name',
        'shared_by.full_name as shared_by_name',
        'assets.name as asset_name',
        'asset_folders.name as folder_name'
      )
      .orderBy('asset_shares.created_at', 'desc');

    return reply.send({ shares });
  });

  // GET /api/assets/admin/logs (Global activity logs)
  app.get('/admin/logs', { preHandler: [authenticate, requireRole('admin')] }, async (request, reply) => {
    const logs = await db('asset_activity_logs')
      .leftJoin('users as actor', 'actor.id', 'asset_activity_logs.user_id')
      .leftJoin('assets', 'assets.id', 'asset_activity_logs.asset_id')
      .leftJoin('asset_folders', 'asset_folders.id', 'asset_activity_logs.folder_id')
      .select(
        'asset_activity_logs.*',
        'actor.full_name as actor_name',
        'actor.email as actor_email',
        'assets.name as asset_name',
        'asset_folders.name as folder_name'
      )
      .orderBy('asset_activity_logs.created_at', 'desc')
      .limit(200);

    return reply.send({ logs });
  });

  // PATCH /api/assets/:id/visibility
  app.patch('/:id/visibility', { preHandler: [authenticate, requireRole('instructor', 'admin')] }, async (request, reply) => {
    const user = (request as any).user;
    const { id } = request.params as { id: string };
    const { visibility, type } = request.body as { visibility: 'public' | 'private', type: 'asset' | 'folder' };
    
    const hasAccess = await AssetService.hasPermission(user.id, user.role, 'share', type, id);
    if (!hasAccess) return reply.status(403).send({ error: 'Access denied to change visibility' });

    const table = type === 'folder' ? 'asset_folders' : 'assets';
    await db(table).where({ id }).update({ visibility });
    await AssetService.logActivity(user.id, 'visibility_changed', { visibility }, type === 'asset' ? id : undefined, type === 'folder' ? id : undefined);
    return reply.send({ success: true, visibility });
  });

  // POST /api/assets/shares
  app.post('/shares', { preHandler: [authenticate, requireRole('instructor', 'admin')] }, async (request, reply) => {
    const user = (request as any).user;
    const { assetId, folderId, sharedWithUserId, permissions, expiresAt } = request.body as any;

    const type = folderId ? 'folder' : 'asset';
    const id = folderId || assetId;
    
    const hasAccess = await AssetService.hasPermission(user.id, user.role, 'share', type, id);
    if (!hasAccess) return reply.status(403).send({ error: 'Access denied to share this item' });

    const [share] = await db('asset_shares').insert({
      asset_id: assetId || null,
      folder_id: folderId || null,
      shared_with_user_id: sharedWithUserId,
      shared_by_user_id: user.id,
      permissions: JSON.stringify(permissions || ['view']),
      expires_at: expiresAt || null,
    }).returning('*');

    await AssetService.logActivity(user.id, 'shared', { shareId: share.id, permissions, sharedWithUserId }, assetId, folderId);
    return reply.status(201).send({ share });
  });

  // GET /api/assets/:id/shares
  app.get('/:id/shares', { preHandler: [authenticate, requireRole('instructor', 'admin')] }, async (request, reply) => {
    const user = (request as any).user;
    const { id } = request.params as { id: string };
    const { type } = request.query as { type: 'asset' | 'folder' };

    const hasAccess = await AssetService.hasPermission(user.id, user.role, 'share', type, id);
    if (!hasAccess) return reply.status(403).send({ error: 'Access denied' });

    const shares = await db('asset_shares')
      .where(type === 'asset' ? { asset_id: id } : { folder_id: id })
      .join('users', 'users.id', 'asset_shares.shared_with_user_id')
      .select('asset_shares.*', 'users.email as shared_with_email', 'users.full_name as shared_with_name');

    return reply.send({ shares });
  });

  // DELETE /api/assets/shares/:shareId
  app.delete('/shares/:shareId', { preHandler: [authenticate, requireRole('instructor', 'admin')] }, async (request, reply) => {
    const user = (request as any).user;
    const { shareId } = request.params as { shareId: string };

    const share = await db('asset_shares').where({ id: shareId }).first();
    if (!share) return reply.status(404).send({ error: 'Share not found' });

    const type = share.folder_id ? 'folder' : 'asset';
    const id = share.folder_id || share.asset_id;

    const hasAccess = await AssetService.hasPermission(user.id, user.role, 'share', type, id);
    if (!hasAccess) return reply.status(403).send({ error: 'Access denied' });

    await db('asset_shares').where({ id: shareId }).delete();
    await AssetService.logActivity(user.id, 'share_revoked', { shareId }, share.asset_id, share.folder_id);

    return reply.status(204).send();
  });
}
