import { basename, dirname } from 'node:path';

// Production already has main's account/OTP/commercial migrations. Applying
// older, unapplied billing migrations must preserve that existing history too.
export function mainBeforeBillingMigrations(paths: readonly string[]): readonly string[] {
  const billing = (path: string) =>
    /_(?:payments_billing_ledger|billing_deposit_application|vnpay_provider_evidence|billing_operations_reporting)$/u.test(
      basename(dirname(path)),
    );
  // SPEC-05 print reporting depends on the accepted Billing ledger. These new
  // migrations were not part of the pre-Billing production history.
  const invitationPrint = (path: string) =>
    /_(?:invitation_design_publication_printable|invitation_print_order_and_billing|invitation_reporting_snapshots|print_commercial_offerings)$/u.test(
      basename(dirname(path)),
    );
  return [
    ...paths.filter((path) => !billing(path) && !invitationPrint(path)),
    ...paths.filter(billing),
    ...paths.filter(invitationPrint),
  ];
}
