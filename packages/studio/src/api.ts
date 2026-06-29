/**
 * API client for dtool Studio backend.
 */

const API_BASE = '/api';

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

interface TemplateListResponse {
  templates: TemplateMeta[];
  count: number;
}

interface TemplateDetailResponse {
  template: TemplateDetail;
}

interface ValidateResponse {
  valid: boolean;
  errors: Array<{ code: string; message: string; severity: string }>;
  template: unknown | null;
}

export async function fetchTemplates(): Promise<TemplateMeta[]> {
  const res = await fetch(`${API_BASE}/templates`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  const data: TemplateListResponse = await res.json();
  return data.templates ?? [];
}

export async function fetchTemplate(id: string): Promise<TemplateDetail> {
  const res = await fetch(`${API_BASE}/templates/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`Template not found: ${id}`);
  const data: TemplateDetailResponse = await res.json();
  return data.template;
}

export async function validateTemplate(yaml: string): Promise<ValidateResponse> {
  const res = await fetch(`${API_BASE}/templates/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ yaml }),
  });
  return res.json();
}

export async function saveTemplate(yaml: string): Promise<{ ok: boolean; id: string; error?: string }> {
  const res = await fetch(`${API_BASE}/templates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ yaml }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    return { ok: false, id: '', error: (err as { error?: string }).error || `HTTP ${res.status}` };
  }
  return res.json();
}
