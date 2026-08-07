// Tiny interpolation for the translatable chrome and narration templates. A
// template is plain text with `{name}` slots, e.g. "Traced {n} steps."
//
// The reason this is its own module rather than a one-line replace: a translated
// template that LOSES a slot is the dangerous case. It renders perfectly and says
// the wrong thing - "Traced steps." with no number in it - and nothing fails. So
// interpolation ships together with the check that a replacement still carries
// every slot the English original had, and callers resolve overrides through that
// check rather than trusting them.

/** Every `{name}` slot in a template, in first-appearance order, deduped. */
export function placeholdersOf(template: string): string[] {
  const out: string[] = [];
  for (const m of String(template).matchAll(/\{(\w+)\}/g)) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/** Fill `{name}` slots from `vars`. A slot with no matching key is left as-is -
 *  visible, rather than silently blanked, so a mistake shows up on screen instead
 *  of hiding as an empty gap. */
export function fill(template: string, vars: Record<string, string | number>): string {
  return String(template).replace(/\{(\w+)\}/g, (whole, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : whole,
  );
}

/** The slots `english` has that `candidate` does not. Empty means the candidate is
 *  safe to use. Extra slots in the candidate are not reported - they render
 *  literally and are self-evident. */
export function missingPlaceholders(english: string, candidate: string): string[] {
  const have = placeholdersOf(candidate);
  return placeholdersOf(english).filter((p) => !have.includes(p));
}

/** One rejected override: the key, and the slots its replacement dropped. */
export interface TemplateIssue {
  key: string;
  missing: string[];
}

/** Merge `overrides` onto `defaults`, REFUSING any override that drops a slot the
 *  default carried. Returns the merged set plus what was refused, so a test or a
 *  translation tool can assert the refusals are empty instead of discovering a
 *  numberless label in the UI. Keys absent from `overrides` keep their default. */
export function mergeTemplates<T extends { [K in keyof T]: string }>(
  defaults: T,
  overrides?: Partial<T>,
): { merged: T; issues: TemplateIssue[] } {
  const merged = { ...defaults };
  const issues: TemplateIssue[] = [];
  if (!overrides) return { merged, issues };
  for (const key of Object.keys(overrides) as Array<keyof T & string>) {
    const value = overrides[key];
    if (typeof value !== "string") continue;
    if (!Object.prototype.hasOwnProperty.call(defaults, key)) {
      merged[key] = value as T[keyof T & string];
      continue;
    }
    const missing = missingPlaceholders(defaults[key], value);
    if (missing.length) {
      issues.push({ key, missing });
      continue;
    }
    merged[key] = value as T[keyof T & string];
  }
  return { merged, issues };
}
