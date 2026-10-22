import crypto from 'node:crypto';
import { queryOne, queryAll, execute } from '../db/database.js';
import { logAccess } from './auditService.js';

const VALID_ASSET_TYPES = ['code_repo', 'pdf_doc', 'design_file', 'domain', 'app_listing', 'other'];

/**
 * Register a new Project Asset.
 * NON-NEGOTIABLE CORE PRINCIPLE:
 * "NOTHING IS PERSONALLY OWNED."
 * owner_entity is ALWAYS hardcoded to 'ORG'. It can NEVER be assigned to an individual user.
 */
export function createAsset({ projectId, type, url, uploadedBy, ipAddress = null }) {
  if (!projectId || !url || !type) {
    return { success: false, status: 400, error: 'projectId, type, and url are required' };
  }

  if (!VALID_ASSET_TYPES.includes(type)) {
    return { success: false, status: 400, error: `Invalid asset type. Allowed: ${VALID_ASSET_TYPES.join(', ')}` };
  }

  const project = queryOne('SELECT id, title FROM projects WHERE id = ?', [projectId]);
  if (!project) {
    return { success: false, status: 404, error: 'Project not found' };
  }

  if (uploadedBy) {
    const user = queryOne('SELECT id, status FROM users WHERE id = ?', [uploadedBy]);
    if (!user) {
      return { success: false, status: 404, error: 'Uploaded by user not found' };
    }
  }

  const assetId = crypto.randomUUID();
  // owner_entity is IMMUTABLY AND HARDCODED TO 'ORG'
  const ownerEntity = 'ORG';

  execute(`
    INSERT INTO assets (
      id, project_id, type, url, owner_entity, uploaded_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `, [
    assetId,
    projectId,
    type,
    url,
    ownerEntity,
    uploadedBy || null
  ]);

  logAccess({
    userId: uploadedBy,
    action: 'asset_registered',
    resource: `/api/projects/${projectId}/assets (asset_id: ${assetId}, type: ${type}, owner_entity: ORG)`,
    ipAddress
  });

  const created = queryOne('SELECT * FROM assets WHERE id = ?', [assetId]);
  return { success: true, status: 201, asset: created };
}

/**
 * Get all assets for a project
 */
export function getProjectAssets(projectId) {
  const project = queryOne('SELECT id, title FROM projects WHERE id = ?', [projectId]);
  if (!project) {
    return { success: false, status: 404, error: 'Project not found' };
  }

  const assets = queryAll(`
    SELECT a.*, u.name as uploaded_by_name, u.email as uploaded_by_email, u.status as uploaded_by_status
    FROM assets a
    LEFT JOIN users u ON a.uploaded_by = u.id
    WHERE a.project_id = ?
    ORDER BY a.created_at DESC
  `, [projectId]);

  return {
    success: true,
    status: 200,
    project: { id: project.id, title: project.title },
    assets: assets.map(a => ({
      ...a,
      uploaded_by_label: a.uploaded_by_status === 'inactive'
        ? `${a.uploaded_by_name} (Former Member)`
        : a.uploaded_by_name
    }))
  };
}
