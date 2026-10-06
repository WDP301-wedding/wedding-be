# Contributing

All four Wedding repositories use `main` as their default integration branch.
Create a short-lived `codex/<module>-<slice>` branch for each change and open a
pull request into `main`.

## Start a change

Run these commands from the repository you are changing:

```powershell
git fetch origin
git switch main
git pull --ff-only
git switch -c codex/my-change
```

Use a descriptive branch name in place of `codex/my-change`. Keep each pull
request focused on one change. For changes spanning repositories, open a pull
request in each affected repository and link the related pull requests.

## Validate and publish

Run the relevant checks in the
[cross-repository development guide](https://github.com/WDP301-wedding/wedding-be/blob/main/docs/cross-repo-development.md#quality-gates).
Commit the reviewed files and push the feature branch:

```powershell
git add <changed-files>
git commit -m "fix: describe the change"
git push -u origin HEAD
```

On GitHub, create a pull request with **base: main** and your feature branch as
the head. Explain the problem, resulting behavior, and validation results.

## Review and merge

Before merging, obtain at least one approval from another team member, resolve
the review conversations, and require all existing CI quality gates to pass.
A failed dependency audit is a failed gate; do not remove or weaken checks to
merge a pull request. New commits require a fresh review.

Merge through the pull request on GitHub. Do not push directly to `main`,
force-push `main`, or delete `main`. When a cross-repository contract pins a
commit SHA, preserve that commit in the merged history or update the consumers
to the final merged artifact before publishing their changes.

After merging, update local `main` with `git pull --ff-only` and start the next
change on a new branch.

## Branch protection availability

The repositories are private. GitHub currently rejects both rulesets and classic
branch protection with HTTP 403 because the current plan does not support this
feature for these repositories. Until protection is enabled, the rules above
are team policy; GitHub does not enforce them against direct pushes.

An organization owner must enable a plan supporting private-repository branch
protection, such as GitHub Team. Then configure `main` to require one approving
review, dismiss stale reviews, require approval of the latest push, resolve all
review conversations, require the existing CI jobs with an up-to-date branch,
apply the rules to administrators, and disallow force pushes and deletion.
