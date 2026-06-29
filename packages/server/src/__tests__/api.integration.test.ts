/**
 * Server API Integration Tests
 *
 * These tests target the deployed server at 192.168.64.132.
 * Set SERVER_URL env var to override the target URL.
 *
 * Run: SERVER_URL=http://192.168.64.132:3001 npx vitest run
 */

import { describe, it, expect } from 'vitest';

const BASE_URL = process.env.SERVER_URL || 'http://192.168.64.132:3001';

interface ApiResponse<T> {
  status: number;
  ok: boolean;
  data: T;
}

async function apiGet<T>(path: string): Promise<ApiResponse<T>> {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url);
  return {
    status: res.status,
    ok: res.ok,
    data: await res.json(),
  };
}

async function apiPost<T>(path: string, body: unknown): Promise<ApiResponse<T>> {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return {
    status: res.status,
    ok: res.ok,
    data: await res.json(),
  };
}

// ── Health Check ──

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const res = await apiGet<{ status: string; uptime: number }>('/health');
    expect(res.status).toBe(200);
    expect(res.data.status).toBe('ok');
    expect(typeof res.data.uptime).toBe('number');
  });
});

// ── Template List ──

describe('GET /api/templates', () => {
  it('returns 200 with template list', async () => {
    const res = await apiGet<{ templates: unknown[]; count: number }>('/api/templates');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.data.templates)).toBe(true);
    expect(res.data.count).toBe(res.data.templates.length);
    // Module count grows with development; verify it's ≥ 8
    expect(res.data.count).toBeGreaterThanOrEqual(8);
  });

  it('each template has required metadata fields', async () => {
    const res = await apiGet<{ templates: Array<Record<string, unknown>> }>('/api/templates');
    for (const t of res.data.templates) {
      expect(typeof t.id).toBe('string');
      expect(t.id).toBeTruthy();
      expect(typeof t.name).toBe('string');
      expect(t.name).toBeTruthy();
      expect(typeof t.description).toBe('string');
      expect(typeof t.category).toBe('string');
    }
  });

  it('templates have unique ids', async () => {
    const res = await apiGet<{ templates: Array<{ id: string }> }>('/api/templates');
    const ids = res.data.templates.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ── Single Template ──

describe('GET /api/templates/:id', () => {
  it('returns 200 for existing template id', async () => {
    // First get the list to find a valid id
    const listRes = await apiGet<{ templates: Array<{ id: string }> }>('/api/templates');
    const firstId = listRes.data.templates[0]?.id;
    if (!firstId) return; // skip if no templates

    const res = await apiGet<{ template: Record<string, unknown> }>(`/api/templates/${firstId}`);
    expect(res.status).toBe(200);
    expect(res.data.template).toBeDefined();
    expect(res.data.template.id).toBe(firstId);
  });

  it('returns 404 for non-existent template', async () => {
    const res = await fetch(`${BASE_URL}/api/templates/nonexistent-template-id`);
    expect(res.status).toBe(404);
  });

  it('template detail includes params and flow', async () => {
    const listRes = await apiGet<{ templates: Array<{ id: string }> }>('/api/templates');
    const firstId = listRes.data.templates[0]?.id;
    if (!firstId) return;

    const res = await apiGet<{ template: Record<string, unknown> }>(`/api/templates/${firstId}`);
    expect(Array.isArray(res.data.template.params)).toBe(true);
    expect(res.data.template.flow).toBeDefined();
  });
});

// ── Template Validation ──

describe('POST /api/templates/validate', () => {
  it('accepts valid YAML template', async () => {
    const yaml = `
version: "0.1"
name: "Test"
description: "test"
category: "工具"
params: []
flow:
  steps:
    - id: s1
      module: input
`.trim();

    const res = await apiPost<{ valid: boolean; errors: unknown[] }>('/api/templates/validate', { yaml });
    expect(res.status).toBe(200);
    expect(res.data.valid).toBe(true);
    expect(res.data.errors).toHaveLength(0);
  });

  it('rejects invalid YAML with missing fields', async () => {
    const yaml = `name: "no-version"`.trim();
    const res = await apiPost<{ valid: boolean; errors: unknown[] }>('/api/templates/validate', { yaml });
    expect(res.status).toBe(200);
    expect(res.data.valid).toBe(false);
    expect(res.data.errors.length).toBeGreaterThan(0);
  });

  it('rejects malformed YAML string', async () => {
    const yaml = 'not: valid: yaml: [[[';
    const res = await apiPost<{ valid: boolean; errors: unknown[] }>('/api/templates/validate', { yaml });
    expect(res.status).toBe(200);
    expect(res.data.valid).toBe(false);
  });

  it('returns 400 when neither yaml nor json provided', async () => {
    const res = await fetch(`${BASE_URL}/api/templates/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('parses valid JSON template', async () => {
    const json = JSON.stringify({
      version: '0.1',
      name: 'JSON Test',
      description: 'from json',
      category: '工具',
      params: [],
      flow: { steps: [{ id: 's1', module: 'input' }] },
    });

    const res = await apiPost<{ valid: boolean; template: unknown }>('/api/templates/validate', { json });
    expect(res.status).toBe(200);
    expect(res.data.valid).toBe(true);
    expect(res.data.template).toBeDefined();
  });
});
