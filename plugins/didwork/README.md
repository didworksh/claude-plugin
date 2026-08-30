# DidWork

Independently verify that the outcomes your software claims are actually true.

DidWork receives a claim (`type` + `expected`), gathers evidence from the authoritative system, and returns a verdict: `verified`, `failed`, or `unknown`. This plugin wires the DidWork MCP server into Claude Code and teaches the agent to gate on verdicts instead of self-grading.

## Contents

| Piece | Path | Purpose |
| --- | --- | --- |
| MCP config | `.mcp.json` | Runs `npx -y @didwork/mcp` with your `DIDWORK_API_KEY` |
| Hook | `hooks/hooks.json` | Injects the verify-outcomes rule at session start |
| Skill | `skills/verify-outcomes/SKILL.md` | Claim types and the verify → gate workflow |
| Command | `commands/verify.md` | `/didwork:verify` a claimed outcome on demand |
| Command | `commands/setup.md` | `/didwork:setup` — guided first run: prove the connection, detect the stack, backfill verdicts |
| Agent | `agents/outcome-verifier.md` | Subagent that verifies one claim and reports the verdict |

## First run

After installing, run `/didwork:setup`. It verifies the MCP connection end-to-end, detects which of your project's systems DidWork can verify, recommends the providers worth connecting, and backfills verdicts on your recent merged PRs and CI runs — so the verification log starts populated with your own work.

## Requirements

- Node.js (for `npx`)
- `DIDWORK_API_KEY` environment variable — get one at [didwork.sh/console](https://didwork.sh/console). Without it the server runs keyless: `http.ok` claims still verify (rate limited, not stored), and every other tool answers with how to unlock itself.

## Supported claim types

Stripe (refunds, payments, subscriptions, invoices), GitHub (PRs, workflows, issues, releases, deploys, files), GitLab (MRs, pipelines, issues), Linear, Jira, Sentry, email delivery, and `http.ok` for any public URL. Full reference: [didwork.sh/docs](https://didwork.sh/docs).
