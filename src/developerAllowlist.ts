/** Google accounts with unlimited meeting credits (no paywall). Normalized via toLowerCase. */
export const DEVELOPER_EMAILS = ["mic6046@gmail.com"] as const;

/** High sentinel so numeric credit checks never block developers. */
export const UNLIMITED_CREDITS_SENTINEL = 999_999;

export function isDeveloperEmail(email: string | null | undefined): boolean {
  if (!email || typeof email !== "string") return false;
  const normalized = email.trim().toLowerCase();
  return (DEVELOPER_EMAILS as readonly string[]).some((e) => e.toLowerCase() === normalized);
}
