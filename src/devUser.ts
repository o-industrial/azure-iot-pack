export type AzureTags =
  | Record<string, string | undefined>
  | undefined
  | null;

let devUserValue: string | null | undefined;

function ensureDevUserValue(): string | undefined {
  if (devUserValue === undefined) {
    const raw = Deno.env.get('DEV_USER')?.trim();
    devUserValue = raw && raw.length > 0 ? raw : null;
  }
  return devUserValue ?? undefined;
}

function normalizeTags(
  tags: AzureTags | undefined,
): Record<string, string> {
  if (!tags || typeof tags !== 'object') {
    return {};
  }

  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(tags)) {
    if (typeof value === 'string' && value.length > 0) {
      normalized[key] = value;
    }
  }
  return normalized;
}

export function withDevUserTag(
  tags: AzureTags,
): Record<string, string> | undefined {
  const normalized = normalizeTags(tags);
  const devUser = ensureDevUserValue();

  if (devUser) {
    normalized.DEV_USER = devUser;
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function applyDevUserTag(
  tags: AzureTags,
  existingTags?: AzureTags,
  onlyIfPresent = false,
): Record<string, string> | undefined {
  const base = normalizeTags(tags);
  const baseDev = base.DEV_USER;
  if (baseDev) {
    delete base.DEV_USER;
  }

  const existing = normalizeTags(existingTags);
  const existingDev = existing.DEV_USER;

  const devUser = ensureDevUserValue();
  const hadDev = Boolean(baseDev ?? existingDev);

  if (devUser) {
    if (!onlyIfPresent || hadDev) {
      base.DEV_USER = devUser;
    } else if (existingDev) {
      base.DEV_USER = existingDev;
    }
  } else if (existingDev) {
    base.DEV_USER = existingDev;
  } else if (baseDev && !onlyIfPresent) {
    base.DEV_USER = baseDev;
  }

  return Object.keys(base).length > 0 ? base : undefined;
}
