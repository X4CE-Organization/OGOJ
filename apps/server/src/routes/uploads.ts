import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { requireUser } from '../lib/auth.js';
import { badRequest } from '../lib/errors.js';
import { num } from '../settings/index.js';
import { publicUploadPath, uploadDir } from '../lib/storage.js';
import { audit } from '../lib/audit.js';

const IMAGE_TYPES = new Map<string, string>([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/gif', '.gif'],
  ['image/webp', '.webp'],
  ['image/svg+xml', '.svg'],
  ['image/x-icon', '.ico'],
]);

const ALLOWED_SUBDIRS = new Set(['avatar', 'banner', 'carousel', 'article', 'problem', 'misc', 'teams', 'site']);

export async function registerUploadRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/upload', async (request) => {
    const user = requireUser(request);
    const file = await (request as any).file({
      limits: { fileSize: num('max_upload_size_mb', 64) * 1024 * 1024 },
    });
    if (!file) throw badRequest('请选择要上传的文件');
    const query = request.query as any;
    const category = ALLOWED_SUBDIRS.has(String(query.category ?? '')) ? String(query.category) : 'misc';
    const isImage = IMAGE_TYPES.has(file.mimetype);
    if (category !== 'problem' && !isImage) {
      throw badRequest('只允许上传图片文件（jpg / png / gif / webp / svg）');
    }
    const buffer = await file.toBuffer();
    const ext = isImage
      ? IMAGE_TYPES.get(file.mimetype)!
      : path.extname(file.filename || '').slice(0, 10) || '.bin';
    const name = `${Date.now().toString(36)}-${randomBytes(6).toString('hex')}${ext}`;
    const dir = uploadDir(category);
    fs.writeFileSync(path.join(dir, name), buffer);
    audit(request, 'upload.file', { detail: { category, name, size: buffer.length } });
    return {
      ok: true,
      url: publicUploadPath(path.join(category, name)),
      path: path.join(category, name),
      size: buffer.length,
      mimetype: file.mimetype,
      uploadedBy: user.username,
    };
  });

  app.get('/api/upload/files', async (request) => {
    requireUser(request);
    const category = ALLOWED_SUBDIRS.has(String((request.query as any)?.category ?? ''))
      ? String((request.query as any).category)
      : 'misc';
    const dir = uploadDir(category);
    const files = fs
      .readdirSync(dir)
      .filter((name) => !name.startsWith('.'))
      .map((name) => {
        const stat = fs.statSync(path.join(dir, name));
        return { name, url: publicUploadPath(path.join(category, name)), size: stat.size, mtime: stat.mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, 200);
    return { category, files };
  });
}
