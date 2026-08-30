#!/bin/sh
# Injected at session start: the DidWork verify-outcomes rule.
# Mirrors rules/verify-outcomes.mdc in the Cursor plugin.
cat <<'EOF'
DidWork is installed. After performing an action whose outcome lives in an external system (payment, refund, PR merge, CI run, deploy, email send, issue state), do not declare it done based on your own output or an API's 200 — call the `did_verify` tool with a claim (`type` + `expected`) and gate on the verdict: `verified` → proceed; `failed` → stop and report the evidence; `unknown` → poll with `did_get`, never treat as success. Prefer specific claim types (`stripe.refund`, `github.pr_merged`, `github.workflow_passed`, `email.delivered`) over generic ones; `http.ok` checks any public URL. For outcomes that must stay true, set a `did_watch`. Never fabricate a verdict — if DidWork is unavailable, say verification could not be performed.
EOF
