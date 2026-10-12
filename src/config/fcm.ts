import { createPrivateKey } from 'node:crypto';
import { z } from 'zod';

const serviceAccount = z.object({
  type: z.literal('service_account'),
  project_id: z.string().regex(/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/u),
  client_email: z.email(),
  private_key: z.string().min(1),
});
export type FcmConfiguration =
  | { enabled: false }
  | {
      enabled: true;
      projectId: string;
      clientEmail: string;
      privateKey: string;
      accountAllowlist: readonly string[] | null;
    };

/** Report variable names only: JSON parse/key errors can contain credentials. */
export function parseFcmConfiguration(
  source: Readonly<Record<string, string | undefined>>,
): FcmConfiguration {
  const enabled = source['NOTIFICATIONS_FCM_ENABLED']?.trim() || 'false';
  if (!['true', 'false'].includes(enabled)) throw new Error('Invalid NOTIFICATIONS_FCM_ENABLED.');
  if (enabled === 'false') return Object.freeze({ enabled: false });
  try {
    const account = serviceAccount.parse(
      JSON.parse(source['NOTIFICATIONS_FCM_SERVICE_ACCOUNT'] ?? ''),
    );
    const key = createPrivateKey(account.private_key);
    if (key.asymmetricKeyType !== 'rsa' || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048)
      throw new Error('key');
    const rawAllowlist = source['NOTIFICATIONS_FCM_ACCOUNT_ALLOWLIST']?.trim();
    const accountAllowlist = rawAllowlist
      ? Object.freeze([
          ...new Set(
            z
              .array(z.uuid().toLowerCase())
              .min(1)
              .max(500)
              .parse(rawAllowlist.split(',').map((v) => v.trim())),
          ),
        ])
      : null;
    return Object.freeze({
      enabled: true,
      projectId: account.project_id,
      clientEmail: account.client_email,
      privateKey: account.private_key,
      accountAllowlist,
    });
  } catch {
    throw new Error(
      'Invalid NOTIFICATIONS_FCM_SERVICE_ACCOUNT or NOTIFICATIONS_FCM_ACCOUNT_ALLOWLIST.',
    );
  }
}
