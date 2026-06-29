/**
 * Template REST API routes.
 *
 * Endpoints:
 *   GET  /api/templates          — list all available templates
 *   GET  /api/templates/:id      — get a single template by id
 *   POST /api/templates/validate — validate a raw template YAML/JSON
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  readFileSync, readdirSync, statSync,
  writeFileSync, mkdirSync, existsSync,
} from 'node:fs';
import { join, relative, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYamlTemplate } from '@dtool-studio/engine';

// Templates directory: use env var (Docker) or resolve relative to server
const MODULES_DIR = process.env.MODULES_DIR
  || join(fileURLToPath(import.meta.url), '..', '..', '..', '..');


interface TemplateMeta {
  id: string;
  name: string;
  description: string;
  category: string;
  tags?: string[];
  author?: string;
  created?: string;
}

interface TemplateDetail extends TemplateMeta {
  params: unknown[];
  flow: unknown;
  raw: string;
}

/**
 * Scan the templates/ directory and return all template metadata.
 */
function scanTemplates(): TemplateMeta[] {
  try {
    const results: TemplateMeta[] = [];
    scanDir(MODULES_DIR, results);
    return results;
  } catch {
    return [];
  }
}

function scanDir(dir: string, results: TemplateMeta[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry);

    if (statSync(fullPath).isDirectory()) {
      scanDir(fullPath, results);
      continue;
    }

    if (!entry.endsWith('.yaml') && !entry.endsWith('.yml')) continue;

    try {
      const content = readFileSync(fullPath, 'utf-8');
      const parsed = parseYamlTemplate(content);

      if (parsed.template) {
        const t = parsed.template;
        const relPath = relative(MODULES_DIR, fullPath).replace(/\.(yaml|yml)$/, '');
        results.push({
          id: relPath.split(sep).join('/'),
          name: t.name,
          description: t.description,
          category: t.category,
          tags: t.tags,
          author: t.author,
          created: t.created,
        });
      }
    } catch {
      // Skip invalid templates silently
    }
  }
}

/**
 * Read a single template by id (file path relative to templates/ dir).
 */
function readTemplate(id: string): TemplateDetail | null {
  // Sanitise: prevent path traversal
  const safeId = id.replace(/\.\.\//g, '').replace(/\.\.\\/g, '');
  const yamlPath = join(MODULES_DIR, `${safeId}.yaml`);
  const ymlPath = join(MODULES_DIR, `${safeId}.yml`);

  let content: string;
  try {
    content = readFileSync(yamlPath, 'utf-8');
  } catch {
    try {
      content = readFileSync(ymlPath, 'utf-8');
    } catch {
      return null;
    }
  }

  const parsed = parseYamlTemplate(content);
  if (!parsed.template) return null;

  const t = parsed.template;
  return {
    id: safeId,
    name: t.name,
    description: t.description,
    category: t.category,
    tags: t.tags,
    author: t.author,
    created: t.created,
    params: t.params,
    flow: t.flow,
    raw: content,
  };
}

export async function registerTemplateRoutes(app: FastifyInstance): Promise<void> {
  // ── GET /api/templates — list all ──
  app.get('/api/templates', async (_req, reply) => {
    const templates = scanTemplates();
    return reply.send({ templates, count: templates.length });
  });

  // ── GET /api/templates/:id — get single ──
  // Use wildcard to support multi-segment ids (e.g. "transform/case-convert")
  app.get<{ Params: { id: string } }>(
    '/api/templates/*',
    async (req, reply) => {
      const id = (req.params as Record<string, string>)['*'];
      if (!id) {
        return reply.status(400).send({ error: 'Template id required' });
      }
      const template = readTemplate(id);
      if (!template) {
        return reply.status(404).send({ error: 'Template not found' });
      }
      return reply.send({ template });
    },
  );

  // ── POST /api/templates — create a new template ──
  app.post<{ Body: { yaml?: string; category?: string } }>(
    '/api/templates',
    async (req, reply) => {
      const { yaml, category } = req.body;

      if (!yaml || typeof yaml !== 'string' || yaml.trim().length === 0) {
        return reply.status(400).send({ error: 'Missing "yaml" field' });
      }

      // Parse the YAML to extract metadata
      let parsed;
      try {
        parsed = parseYamlTemplate(yaml);
      } catch {
        return reply.status(400).send({ error: 'Invalid YAML' });
      }

      if (!parsed.template) {
        return reply.status(400).send({
          error: 'Invalid template',
          details: parsed.validation.errors,
        });
      }

      const t = parsed.template;

      // Use explicit category or fall back to template's category
      const finalCategory = (category || t.category || '自定义')
        .replace(/\s+/g, '_')
        .replace(/[^a-zA-Z0-9_\-\u4e00-\u9fff]/g, '')
        .toLowerCase();

      // Validate category — must be one of the known dirs
      const validCategories = new Set([
        'encoding', 'security', 'transform', 'combine', 'tools',
        'io', 'wrapping', 'injection', 'transformation',
        '编码/解码', '自定义', 'official', 'user', 'system',
      ]);
      // Accept any non-empty category for user-created modules
      if (!finalCategory || finalCategory.length === 0) {
        return reply.status(400).send({ error: 'Invalid category' });
      }

      // Generate an id from the name (kebab-case)
      const slug = t.name
        .replace(/[^\w\u4e00-\u9fff\-\s]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .toLowerCase()
        || 'untitled';

      // Avoid collisions: append suffix if file exists
      let id = slug;
      let suffix = 1;
      const catDir = join(MODULES_DIR, finalCategory);
      mkdirSync(catDir, { recursive: true });
      while (existsSync(join(catDir, `${id}.yaml`))) {
        id = `${slug}-${++suffix}`;
      }

      // Write the YAML file
      const filePath = join(catDir, `${id}.yaml`);
      try {
        writeFileSync(filePath, yaml, 'utf-8');
      } catch (err) {
        return reply.status(500).send({
          error: 'Failed to write template file',
          details: String(err),
        });
      }

      const templateId = `${finalCategory}/${id}`;
      return reply.status(201).send({ ok: true, id: templateId });
    },
  );

  // ── POST /api/templates/validate — validate raw template ──
  app.post<{ Body: { yaml?: string; json?: string } }>(
    '/api/templates/validate',
    async (req, reply) => {
      const { yaml, json } = req.body;

      if (!yaml && !json) {
        return reply.status(400).send({
          error: 'Provide either "yaml" or "json" field',
        });
      }

      let result;
      if (yaml) {
        const { parseYamlTemplate } = await import('@dtool-studio/engine');
        result = parseYamlTemplate(yaml);
      } else {
        const { parseJsonTemplate } = await import('@dtool-studio/engine');
        result = parseJsonTemplate(json!);
      }

      return reply.send({
        valid: result.validation.valid,
        errors: result.validation.errors,
        template: result.template ?? null,
      });
    },
  );
}
