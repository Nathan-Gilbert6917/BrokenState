# AGENTS.md

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues for `Nathan-Gilbert6917/BrokenState` (via the `gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` plus `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Feature map

Every major game feature, grouped by area, one line each with the modules and tests behind it: `docs/agents/features.md`. Read it first to find where a system lives. The detail (the user's requests and dates, rules, numbers, function names) is in `docs/features/<area>.md`, linked from each line; add new features in the same format (see the note at the top of the index).
