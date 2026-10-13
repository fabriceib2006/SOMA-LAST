export function cleanUndefined<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(cleanUndefined) as unknown as T;
  }
  const cleaned: any = {};
  for (const key of Object.keys(obj)) {
    const val = (obj as any)[key];
    if (val !== undefined) {
      // Safeguard against exceeding Firestore 1MB (1,048,576 bytes) document limit.
      // Compressed payloads under 950,000 chars are fully preserved for seamless multi-device sync.
      if ((key === 'fileData' || key === 'fileDataUrl') && typeof val === 'string' && val.length > 950000) {
        console.warn(`Omitted oversized ${key} of length ${val.length} to prevent Firestore 1MB limit error.`);
        continue;
      }
      cleaned[key] = cleanUndefined(val);
    }
  }
  return cleaned;
}

