import { createHash } from 'node:crypto';

export type CanonicalRequestValue =
  | boolean
  | number
  | string
  | null
  | readonly CanonicalRequestValue[]
  | Readonly<{ [key: string]: CanonicalRequestValue }>;

export class CanonicalRequestError extends Error {
  override readonly name = 'CanonicalRequestError';

  constructor() {
    super('The request payload must contain only finite, acyclic JSON values.');
  }
}

function serializePrimitive(value: boolean | number | string): string {
  const serialized = JSON.stringify(value);

  if (serialized === undefined) {
    throw new CanonicalRequestError();
  }

  return serialized;
}

function serializeCanonical(value: unknown, ancestors: Set<object>): string {
  if (value === null) {
    return 'null';
  }

  if (typeof value === 'string' || typeof value === 'boolean') {
    return serializePrimitive(value);
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new CanonicalRequestError();
    }

    return serializePrimitive(value);
  }

  if (typeof value !== 'object' || ancestors.has(value)) {
    throw new CanonicalRequestError();
  }

  ancestors.add(value);

  try {
    if (Array.isArray(value)) {
      const entries = value.map((entry, index) => {
        if (!Object.hasOwn(value, index)) {
          throw new CanonicalRequestError();
        }

        return serializeCanonical(entry, ancestors);
      });

      return `[${entries.join(',')}]`;
    }

    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new CanonicalRequestError();
    }

    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new CanonicalRequestError();
    }

    const entries = Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${serializePrimitive(key)}:${serializeCanonical(Reflect.get(value, key), ancestors)}`,
      );

    return `{${entries.join(',')}}`;
  } finally {
    ancestors.delete(value);
  }
}

export function canonicalizeRequest(payload: unknown): string {
  return serializeCanonical(payload, new Set());
}

export function hashCanonicalRequest(payload: unknown): string {
  return createHash('sha256').update(canonicalizeRequest(payload), 'utf8').digest('hex');
}
