import { getByPath } from "./json-path";

function formatTemplateValue(value: unknown): string {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map((item) => String(item)).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function interpolateTemplate(template: string, context: Record<string, unknown>): string {
  return template.replace(/\{([^}]+)\}/g, (_match, token: string) => {
    const key = token.trim();
    const direct = context[key];
    if (direct != null) return formatTemplateValue(direct);

    const nested = getByPath(context, key);
    if (nested != null) return formatTemplateValue(nested);

    return `{${key}}`;
  });
}