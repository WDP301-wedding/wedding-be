# RV-06 bounded operator retention

The current identity and consultation retention CLIs were executed against a
populated task-owned disposable loopback PostgreSQL database, using batch size 1.
[Recorded run IDs, counts and audit matches](rv06-retention-2026-10-12.json)
come from those actual child processes and their persisted owner audits.
The fixture database was dropped by the test harness afterward. No shared or
production customer data was cleaned up.

Target inspection opens no database connection and reveals no credentials.
Execution requires confirmation, the exact host/port/database/schema fingerprint,
an opaque operator identifier and a bounded batch. Missing/mismatched arguments
fail before connecting. Each successful batch, including zero, has an atomic
owner audit correlated to the CLI request ID/operator. A failed process is not
completion; operators inspect the audit before retrying.

The rehearsal anonymized one due disabled account and removed two old revoked
sessions across bounded/concurrent batches. One recent revoked session remained.
Accounts with a legal hold, missing terminal facts or future linked financial
eligibility remained identifiable. A stale cached account eligibility date cannot
override a later linked-record eligibility date. Replays changed nothing.

The current intake script deleted one old unconverted lead, scrubbed one converted
lead's contact and bride/groom names, preserved its consultation reference and
retained a recent lead. Replay returned zero deleted/scrubbed records.

[Operator ownership and schedule](../../docs/identity-access-operations.md): the
deployment operator reviews the authorized target daily at 02:00
Asia/Ho_Chi_Minh, runs at most ten batches of 100, records counts/run IDs and stops
each command on a zero batch. Holds and missing facts are reviewed rather than
bypassed. Remaining work is deferred to the next window. This establishes the
manual procedure; it does not install an automatic job or authorize future cleanup
of shared data. Configuration, disposable execution and production operation are
separate evidence fields.
