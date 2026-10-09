import { basename, dirname } from 'node:path';

// Production already has main's account/OTP/commercial migrations. Applying
// older, unapplied billing migrations must preserve that existing history too.
export function mainBeforeBillingMigrations(paths: readonly string[]): readonly string[] {
  const billing = (path: string) =>
    /_(?:payments_billing_ledger|billing_deposit_application|vnpay_provider_evidence|billing_operations_reporting)$/u.test(
      basename(dirname(path)),
    );
  return [...paths.filter((path) => !billing(path)), ...paths.filter(billing)];
}
