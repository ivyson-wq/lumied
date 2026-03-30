// ═══════════════════════════════════════════════════════════════
//  Shared: Input Validation + Sanitization
//  Lightweight validation without external deps (Deno-compatible)
// ═══════════════════════════════════════════════════════════════

export type ValidationRule = {
  required?: boolean;
  type?: 'string' | 'number' | 'boolean' | 'email' | 'uuid' | 'date' | 'array';
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: RegExp;
  enum?: string[];
};

export type Schema = Record<string, ValidationRule>;

export type ValidationError = {
  field: string;
  message: string;
  code: string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validate input against a schema. Returns array of errors (empty = valid).
 */
export function validate(data: Record<string, unknown>, schema: Schema): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const [field, rules] of Object.entries(schema)) {
    const value = data[field];

    // Required check
    if (rules.required && (value === undefined || value === null || value === '')) {
      errors.push({ field, message: `${field} é obrigatório.`, code: 'REQUIRED' });
      continue;
    }

    if (value === undefined || value === null || value === '') continue;

    // Type checks
    if (rules.type === 'string' && typeof value !== 'string') {
      errors.push({ field, message: `${field} deve ser texto.`, code: 'INVALID_TYPE' });
    }
    if (rules.type === 'number' && typeof value !== 'number' && isNaN(Number(value))) {
      errors.push({ field, message: `${field} deve ser número.`, code: 'INVALID_TYPE' });
    }
    if (rules.type === 'boolean' && typeof value !== 'boolean') {
      errors.push({ field, message: `${field} deve ser verdadeiro/falso.`, code: 'INVALID_TYPE' });
    }
    if (rules.type === 'email' && (typeof value !== 'string' || !EMAIL_RE.test(value))) {
      errors.push({ field, message: `${field} deve ser um email válido.`, code: 'INVALID_EMAIL' });
    }
    if (rules.type === 'uuid' && (typeof value !== 'string' || !UUID_RE.test(value))) {
      errors.push({ field, message: `${field} deve ser um UUID válido.`, code: 'INVALID_UUID' });
    }
    if (rules.type === 'date' && (typeof value !== 'string' || !DATE_RE.test(value))) {
      errors.push({ field, message: `${field} deve ser uma data (YYYY-MM-DD).`, code: 'INVALID_DATE' });
    }
    if (rules.type === 'array' && !Array.isArray(value)) {
      errors.push({ field, message: `${field} deve ser uma lista.`, code: 'INVALID_TYPE' });
    }

    // String length
    if (typeof value === 'string') {
      if (rules.minLength && value.length < rules.minLength) {
        errors.push({ field, message: `${field} deve ter no mínimo ${rules.minLength} caracteres.`, code: 'TOO_SHORT' });
      }
      if (rules.maxLength && value.length > rules.maxLength) {
        errors.push({ field, message: `${field} deve ter no máximo ${rules.maxLength} caracteres.`, code: 'TOO_LONG' });
      }
    }

    // Number range
    if (typeof value === 'number' || (rules.type === 'number' && !isNaN(Number(value)))) {
      const num = Number(value);
      if (rules.min !== undefined && num < rules.min) {
        errors.push({ field, message: `${field} deve ser no mínimo ${rules.min}.`, code: 'TOO_LOW' });
      }
      if (rules.max !== undefined && num > rules.max) {
        errors.push({ field, message: `${field} deve ser no máximo ${rules.max}.`, code: 'TOO_HIGH' });
      }
    }

    // Pattern
    if (rules.pattern && typeof value === 'string' && !rules.pattern.test(value)) {
      errors.push({ field, message: `${field} tem formato inválido.`, code: 'INVALID_FORMAT' });
    }

    // Enum
    if (rules.enum && !rules.enum.includes(String(value))) {
      errors.push({ field, message: `${field} deve ser um de: ${rules.enum.join(', ')}.`, code: 'INVALID_ENUM' });
    }
  }

  return errors;
}

/**
 * Sanitize string input (prevent XSS in stored data)
 */
export function sanitize(value: string): string {
  return value
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .trim();
}

/**
 * Sanitize all string fields in an object
 */
export function sanitizeBody(body: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (key === 'action' || key === '_token' || key === '_prof_token' || key === '_aluno_token') {
      clean[key] = value; // Don't sanitize system fields
    } else if (typeof value === 'string') {
      clean[key] = sanitize(value);
    } else {
      clean[key] = value;
    }
  }
  return clean;
}

// ═══ Common Schemas ═══

export const loginSchema: Schema = {
  email: { required: true, type: 'email', maxLength: 255 },
  senha: { required: true, type: 'string', minLength: 6, maxLength: 128 },
};

export const idSchema: Schema = {
  id: { required: true, type: 'uuid' },
};

export const paginationSchema: Schema = {
  limit: { type: 'number', min: 1, max: 500 },
  offset: { type: 'number', min: 0 },
};
