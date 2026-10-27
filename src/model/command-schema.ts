// Declarative field specs shared by every VCT command. The same spec drives
// strict parsing, describe() and the agent guide, so there is one list only.

export type FieldSpec =
  | { type: "string"; required?: boolean; maxLength?: number; allowEmpty?: boolean; description?: string }
  | { type: "id"; required?: boolean; description?: string }
  | { type: "number"; required?: boolean; min?: number; max?: number; integer?: boolean; description?: string }
  | { type: "boolean"; required?: boolean; description?: string }
  | { type: "enum"; required?: boolean; values: readonly string[]; description?: string }
  | { type: "color"; required?: boolean; description?: string }
  | { type: "object"; required?: boolean; nullable?: boolean; description?: string }
  | { type: "array"; required?: boolean; maxItems?: number; description?: string };

export type FieldMap = Readonly<Record<string, FieldSpec>>;

const COLOR = /^#[0-9a-f]{6}$/i;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function checkField(name: string, spec: FieldSpec, value: unknown) {
  switch (spec.type) {
    case "id":
      if (typeof value !== "string" || !value.trim() || value.length > 200) throw new Error(`${name} deve conter 1–200 caracteres.`);
      return;
    case "string": {
      const max = spec.maxLength ?? 200;
      if (typeof value !== "string" || (!spec.allowEmpty && !value.trim()) || value.length > max) {
        throw new Error(`${name} deve ser texto com ${spec.allowEmpty ? "0" : "1"}–${max} caracteres.`);
      }
      return;
    }
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${name} precisa ser um número finito.`);
      if (spec.integer && !Number.isInteger(value)) throw new Error(`${name} precisa ser inteiro.`);
      if ((spec.min !== undefined && value < spec.min) || (spec.max !== undefined && value > spec.max)) {
        throw new Error(`${name} deve estar entre ${spec.min ?? "-∞"} e ${spec.max ?? "∞"}.`);
      }
      return;
    case "boolean":
      if (typeof value !== "boolean") throw new Error(`${name} deve ser booleano.`);
      return;
    case "enum":
      if (typeof value !== "string" || !spec.values.includes(value)) throw new Error(`${name} deve ser ${spec.values.join("|")}.`);
      return;
    case "color":
      if (typeof value !== "string" || !COLOR.test(value)) throw new Error(`${name} deve ser uma cor #rrggbb.`);
      return;
    case "object":
      if (value === null && spec.nullable) return;
      if (!isRecord(value)) throw new Error(`${name} deve ser um objeto.`);
      return;
    case "array":
      if (!Array.isArray(value) || (spec.maxItems !== undefined && value.length > spec.maxItems)) {
        throw new Error(`${name} deve ser uma lista${spec.maxItems !== undefined ? ` com até ${spec.maxItems} itens` : ""}.`);
      }
  }
}

/** Rejects unknown fields, checks required ones and validates each value. */
export function parseFields(value: Record<string, unknown>, fields: FieldMap, context = "comando") {
  for (const key of Object.keys(value)) {
    if (key !== "type" && !Object.hasOwn(fields, key)) throw new Error(`Campo desconhecido no ${context}: ${key}.`);
  }
  for (const [name, spec] of Object.entries(fields)) {
    if (!(name in value) || value[name] === undefined) {
      if (spec.required) throw new Error(`Campo obrigatório: ${name}.`);
      continue;
    }
    checkField(name, spec, value[name]);
  }
}

/** One-line text form of a field, e.g. `startTime!:number 0..7200` (! marks required). */
export function describeField(name: string, spec: FieldSpec) {
  const optional = spec.required ? "!" : "";
  switch (spec.type) {
    case "number": {
      const range = spec.min !== undefined || spec.max !== undefined ? ` ${spec.min ?? ""}..${spec.max ?? ""}` : "";
      return `${name}${optional}:${spec.integer ? "int" : "number"}${range}`;
    }
    case "enum": return `${name}${optional}:${spec.values.join("|")}`;
    default: return `${name}${optional}:${spec.type}`;
  }
}
