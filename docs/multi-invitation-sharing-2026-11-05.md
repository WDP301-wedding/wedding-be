# Independent links for saved invitation designs — 5 November 2026

## Owner-approved scope

The owner requested all saved invitation designs in wedding-web Sharing, clearer
design names, then the same behavior in PRM-app (Flutter). During implementation
the owner explicitly selected separate links/QR codes for simultaneous sharing.
This authorizes the supporting backend extension and PRM-app changes for this
request. wedding-app and wedding-manage-web are unchanged.

## API and authorization

`GET /api/v1/bookings/{bookingId}/invitations/{designId}/publication` returns:

```json
{
  "data": {
    "publicationRevision": 1,
    "published": true,
    "publicSlug": "<64 lowercase hexadecimal characters>",
    "publishedRevisionId": "<uuid>",
    "designRevisionId": "<uuid>"
  }
}
```

A never-published design has revision 0 and null slug/revision IDs. An unpublished
design retains its monotonic publication revision while returning null public
fields. The read requires an authorized owning FULL Couple (Web or Android) or
Manager. Completed/settled preparation retains this read; writes retain the
existing `PREPARATION_READ_ONLY` denial. No private content or guest data is returned.
Unexpected query parameters are rejected. Missing authentication is 401; concealed
ownership/design mismatches are 404; invalid input is 422.

Existing POST/DELETE publication paths and schemas are retained. Their revision CAS
now belongs to the specified design. A new design begins at publication revision
0, independently of other designs. `INVITATION_PUBLICATION_STALE` remains 409.
Existing booking serialization, idempotency receipts, exact design revision checks,
authorization rechecks, audit and outbox atomicity remain in place. Clients must
read each design's state rather than copying the booking-wide legacy snapshot.
The exact new route is included in generated OpenAPI.

## Storage and compatibility

Forward migration `20261105090000_per_design_publication` changes the identity's
primary key to its existing UUID and adds a unique nullable design ID. Legacy
identities are marked as the booking default and bound to their current design,
or the most recent historical publication if already unpublished. An unused
legacy identity can be bound on its first successful publication. No slug,
public URL, identity UUID, publication revision, frozen content, print snapshot,
guest credential or payment/contract/invoice history is rewritten.

New designs receive independent random stable slugs. The database prevents moving
a bound identity to another design, changing its default flag, cross-booking
design/publication references, or allocating two defaults. Migration backfill
temporarily suspends only the old head-update trigger inside one transaction and
flushes deferred owner checks before altering the key; all guards are restored.

Generic read/QR resolves by slug. Unpublishing conceals only that design. An image
remains publicly readable while a live publication references it; a post-storage
recheck prevents serving an asset after its authorization is removed. New print
captures use the corresponding design's link; retained print content is unchanged.

The original default identity continues to serve existing named-guest credentials
and legacy booking-wide readers/realtime snapshots. Publishing a different design
does not repoint those credentials. No guest response/attendance feature is added.

## Release and verification

Release migration and compatible backend before the new web/PRM clients. Older
clients' booking-wide state cannot represent simultaneous publications; refresh
clients together. A rollback must retain the expanded identity table and links;
do not restore a booking-only unique key or erase newly issued identities. Fix
forward if necessary. No shared/hosted migration has been applied in this task.

PostgreSQL verification uses fresh disposable databases on local loopback, with
controlled storage/provider fixtures. Tests exercise simultaneous publication of
three designs, stable slugs across update/unpublish/republish, isolated removal,
CAS/idempotent replay, correct print identity, shared-asset visibility, HTTP auth,
Android ownership and retained reads after completion. The migration test seeds
active and unpublished legacy identities before applying the new migration and
checks unchanged links, revisions and frozen content.

The wider historical studio-wave suite has six pre-existing seating failures;
the same six were reproduced on untouched backend commit `2afe1d1` in an isolated
checkout. These are not evidence for this extension. Focused extension/migration
checks and retained PDF checks are reported separately. No real provider, paid
generation, payment, external message, shared-data mutation or hosted acceptance
is claimed.

Final local evidence: six focused publication/auth/asset/print-identity and
migration checks pass; seven retained-PDF/migration checks pass (the migration
check is included in both commands). Web: 79 focused tests and production build
pass; the deliberate one-design-only regression is rejected by the new tests.
PRM-app: all 107 Flutter tests and analyze pass. Browser previews use synthetic
responses and are separate from the native PostgreSQL evidence.
