/**
 * Template REST API routes.
 *
 * Endpoints:
 *   GET  /api/templates          — list all available templates
 *   GET  /api/templates/:id      — get a single template by id
 *   POST /api/templates/validate — validate a raw template YAML/JSON
 */

import type { FastifyInstance } from 'fastify';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYamlTemplate } from '@dtool-studio/engine';

// Templates directory: resolve relative to the monorepo root
const MONOREPO_ROOT = join(fileURLToPath(import.meta.url), '..', '..', '..', '..', '..');
const TEMPLATES_DIR = join(MONOREPO_ROOT, 'templates');

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
    scanDir(TEMPLATES_DIR, results);
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
        const relPath = relative(TEMPLATES_DIR, fullPath).replace(/\.(yaml|yml)$/, '');
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
  const yamlPath = join(TEMPLATES_DIR, `${safeId}.yaml`);
  const ymlPath = join(TEMPLATES_DIR, `${safeId}.yml`);

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
  app.get<{ Params: { id: string } }>(
    '/api/templates/:id',
    async (req, reply) => {
      const template = readTemplate(req.params.id);
      if (!template) {
        return reply.status(404).send({ error: 'Template not found' });
      }
      return reply.send({ template });
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
