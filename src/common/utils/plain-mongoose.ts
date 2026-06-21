type MongooseSubdocument = {
  toObject?: (...args: unknown[]) => unknown;
};

/**
 * Converts a Mongoose subdocument (or array item) into a plain object safe for JSON.
 * Without this, nested schemas leak `_doc`, `$__parent`, etc. in API responses.
 */
export function plainSubdocument<T>(value: unknown): T | undefined {
  if (value == null) return undefined;
  if (typeof (value as MongooseSubdocument).toObject === 'function') {
    return (value as MongooseSubdocument).toObject!() as T;
  }
  return value as T;
}

export function plainSubdocumentArray<T>(values: unknown): T[] {
  if (!Array.isArray(values) || values.length === 0) return [];
  return values.map((item) => plainSubdocument<T>(item) as T);
}
