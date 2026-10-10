# v0 prompt — wedding-app Android visual prototype

Read the shared foundation first. Design an Android Couple companion for the existing Expo/React Native application. v0 may provide a browser-based visual prototype, but such output is not React Native implementation. Explicitly identify that distinction. Produce a native-ready screen/component specification or React Native output only if supported. Do not silently replace Expo with a WebView/Next.js app.

## Art direction and shell

Intimate planning notebook: ivory canvas, forest date/venue anchors, champagne hairlines, native task lists with separators, compact warm image where useful. Be Vietnam Pro for all Vietnamese text. No serif Vietnamese, all-caps accents, gradient cards, desktop sidebar, huge desktop forms squeezed into a phone or mock analytics dashboard.

Suggested navigation grouping, not a new backend feature: Tổng quan / Kế hoạch / Thiệp / Tài khoản. Guest/billing/media/seating entry points live within appropriate screens; keep bottom navigation small. Safe areas, Android back behavior, native bottom sheets, ≥44px targets, readable form/keyboard behavior, reduced motion and semantic dark mode.

Android starts after FULL Couple access and confirmed deposit. Restricted prospects use Web proposal workspace. Show a helpful access state and a route to the existing sign-in/authorized surface; do not put pre-deposit collaboration into the Android required scope. Account/logout uses existing session patterns.

## First build: A02 and A05–A07

Overview: event date/time/hall, one next action and a short useful milestone/task list. No invented progress percentage. Warm content-led first viewport, not a mandatory marketing hero. Sample Vietnamese event labels and meaningful date formatting.

Invitation: full visual preview from selected design and approved public event content. Variant navigation where available. Quick edit is TEXT FIELDS ONLY: couple text, greeting/message/footer allowed by contract; revision-bound save, stale state and retry. No mobile full canvas, AI background editor, freeform HTML or geometry tools.

Preview/share: generic public link/QR sharing uses native share concept, distinguishes unpublished/available state and does not leak originals. Personalized household link sharing is a different action and screen. Provide a browser-mock share sheet for prototype, labeled as simulated; actual Android integration later uses native sharing. Generic QR never becomes RSVP or check-in authority.

Print tracking: order list/detail, variant quantities, exact quote amount/expiry, accepted frozen preview and state progression. Couple approval/replacement review where authorized by actual client contract. Do not show Manager quote/production/ready/handover controls. Cancellation confirmation before production is distinct from Manager cancellation and billing credit. Show waiting/pending/error and preserved history.

## Additional screens from A01–A11

Media: private gallery/preview and contract-permitted pre-cutoff upload/replace/tombstone. Max 100 originals/1 GiB and 25 MiB JPEG/PNG/WebP per file; current cutoff visible. No public album or photo-editing tool. Native picker interaction must be simulated clearly unless native export is actually supplied.

Timeline: current effective schedule, review/replacement status and allowed next action. Prior effective revision remains during pending change. Restaurant/couple approvals bind to exact revision.

Household list: search, group filter, representative name, expected/responding counts and RSVP status. Add/edit in focused native sheets; no required companion names. Personalized link/share separate from generic invitation. Group labels/colors consistent with Web. Archived and declined contribution rules remain backend-owned.

Seating: fixed layout preview, group labels and compatible choices where authorized. No individual seat assignment, table movement, resizing or adding/removing tables. Accessible legend and requires-review state if expected count is outside compatible range.

Billing: safe authoritative amount/state summaries and history, print charge references, current outstanding and credit distinction. Native progress/return handling must wait for verified outcome; not declare paid from a browser redirect. Show manual refund record, not an automatic refund command.

Notifications/account: useful milestone, quotation, cutoff and readiness entries where supported; no real tokens/contact lists in fixtures, no Manager security controls. Keep session expiry and recovery visible.

## Acceptance

Provide 360px and 412px phone layouts, adjacent widths, safe-area/keyboard variants and dark-mode samples. Vietnamese wrapping and contrast checked; no dead edit/save/share buttons. Interactive mock fixtures explicitly marked prototype. Return screen-ID coverage, theme token mapping and notes needed to port to existing Expo components. Do not claim a browser preview is an Android build, device-tested screen or working native payment/share integration.
