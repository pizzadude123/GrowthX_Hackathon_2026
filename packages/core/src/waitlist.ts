const SIMPLE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeWaitlistEmail(input: string): string {
  const normalized = input.trim().toLowerCase();
  if (!normalized || normalized.length > 254 || !SIMPLE_EMAIL.test(normalized)) {
    throw new Error('Enter a valid email address.');
  }
  return normalized;
}
