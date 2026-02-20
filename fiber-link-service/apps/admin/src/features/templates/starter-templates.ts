export type TemplateId = "single-community" | "multi-community";

export type StarterTemplate = {
  id: TemplateId;
  version: string;
  config: Record<string, string>;
};

export type ApplyResult = {
  nextConfig: Record<string, string>;
  changedKeys: string[];
  metadata: { templateId: TemplateId; version: string };
};

export const TEMPLATE_CATALOG: StarterTemplate[] = [
  { id: "single-community", version: "1.0.0", config: { MODE: "single", RETRY_LIMIT: "3" } },
  { id: "multi-community", version: "1.0.0", config: { MODE: "multi", RETRY_LIMIT: "5" } },
];

export function previewTemplateDiff(current: Record<string, string>, template: StarterTemplate): string[] {
  return Object.entries(template.config).map(([key, value]) => `${key}: ${current[key] ?? "<unset>"} -> ${value}`);
}

export function applyTemplate(
  current: Record<string, string>,
  template: StarterTemplate,
  allowOverwrite = false,
): ApplyResult {
  const conflict = Object.keys(template.config).find((k) => current[k] && current[k] !== template.config[k]);
  if (conflict && !allowOverwrite) {
    throw new Error(`Conflict on ${conflict}; explicit confirmation required`);
  }

  const nextConfig = { ...current, ...template.config };
  const changedKeys = Object.keys(template.config).filter((k) => current[k] !== nextConfig[k]);
  return { nextConfig, changedKeys, metadata: { templateId: template.id, version: template.version } };
}

export function rollbackTemplate(previous: Record<string, string>): Record<string, string> {
  return { ...previous };
}
