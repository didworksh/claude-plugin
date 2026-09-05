# DidWork

Independently verify that the outcomes your software claims are actually true.

DidWork receives a claim (`type` + `expected`), gathers evidence from the authoritative system, and returns a verdict: `verified`, `failed`, or `unknown`. This plugin wires the DidWork MCP server into Claude Code and teaches the agent to gate on verdicts instead of self-grading.

## Contents

| Piece | Path | Purpose |
| --- | --- | --- |
| MCP config | `.mcp.json` | Runs `npx -y @didwork/mcp` with your `DIDWORK_API_KEY` |
| Hook | `hooks/verify-outcomes-rule.sh` | Injects the verify-outcomes rule at session start |
| Hook | `hooks/stop-verify-gate.mjs` | Stop gate: blocks ending the turn with unverified external outcomes |
| Skill | `skills/verify-outcomes/SKILL.md` | Claim types and the verify → gate workflow |
| Command | `commands/verify.md` | `/didwork:verify` a claimed outcome on demand |
| Command | `commands/setup.md` | `/didwork:setup` — guided first run: prove the connection, detect the stack, backfill verdicts |
| Agent | `agents/outcome-verifier.md` | Subagent that verifies one claim and reports the verdict |

## First run

After installing, run `/didwork:setup`. It verifies the MCP connection end-to-end, detects which of your project's systems DidWork can verify, recommends the providers worth connecting, and backfills verdicts on your recent merged PRs and CI runs — so the verification log starts populated with your own work.

## Enforcement: the Stop gate

The session-start rule asks the agent to verify; the Stop gate makes sure it did. When the agent tries to end its turn after running commands whose outcomes live in external systems — `git push`, `gh pr merge`, `npm publish`, deploys (`wrangler`, `vercel`, `fly`, `terraform apply`, …), Stripe CLI mutations, mutating `curl` calls to remote hosts — with no DidWork verification afterward, the stop is blocked once and the agent is told exactly what to verify and with which claim types. A `did_verify` / `did_get` / `did_watch` call (or a keyless `curl` to `api.didwork.sh/v1/verify`) after the last side effect satisfies the gate.

The gate never loops (a stop forced by the gate itself always passes), fails open on any error, ignores commands targeting localhost, and ignores heredoc bodies — a fixture or doc written with `cat > file <<'EOF'` that mentions `npm publish` is data, not a publish. Disable it with `DIDWORK_STOP_GATE=off` in your environment.

## Requirements

- Node.js (for `npx`)
- `DIDWORK_API_KEY` environment variable — get one at [didwork.sh/console](https://didwork.sh/console). Without it the server runs keyless: `http.ok` claims still verify (rate limited, not stored), and every other tool answers with how to unlock itself.

## Supported claim types

Stripe (refunds, payments, subscriptions, invoices), GitHub (PRs, workflows, issues, releases, deploys, files), GitLab (MRs, pipelines, issues), Linear, Jira, Sentry, email delivery, and `http.ok` for any public URL. Full reference: [didwork.sh/docs](https://didwork.sh/docs).
