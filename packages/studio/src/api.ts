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
  const data: TemplateListResponse = await res.json();
  return data.templates;
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
