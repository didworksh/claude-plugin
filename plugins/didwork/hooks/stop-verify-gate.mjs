#!/usr/bin/env node
// Stop gate: the agent cannot end its turn having caused external outcomes
// it never verified. Reads the session transcript, finds side-effectful
// commands issued after the last DidWork verification, and blocks the stop
// once with instructions to verify. Fails open: any error allows the stop —
// the gate must never break a session.
//
// Opt out with DIDWORK_STOP_GATE=off.

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// Command patterns whose outcome lives in an external system, each with the
// claim types to suggest. Order matters: first match wins.
const SIDE_EFFECTS = [
  {
    pattern: /\bgit\s+push\b/,
    hint: "github.workflow_passed (the CI run it triggered), github.commit_in_branch",
  },
  {
    pattern: /\bgh\s+pr\s+merge\b/,
    hint: "github.pr_merged",
  },
  {
    pattern: /\bgh\s+release\s+create\b/,
    hint: "github.release_published",
  },
  {
    pattern: /\bglab\s+mr\s+merge\b/,
    hint: "gitlab.mr_merged",
  },
  {
    pattern: /\b(npm|pnpm|yarn)\s+publish\b/,
    hint: "http.ok on the package's registry page",
  },
  {
    pattern:
      /\b(wrangler\s+(deploy|publish|versions\s+upload)|vercel(\s+deploy|\s+--prod|\s+prod)|fly(ctl)?\s+deploy|netlify\s+deploy|firebase\s+deploy|cdk\s+deploy|pulumi\s+up|terraform\s+apply|kubectl\s+(apply|rollout)|helm\s+(install|upgrade)|railway\s+up|eb\s+deploy)\b/,
    hint: "http.ok on the deployed URL or health endpoint, github.deployment_succeeded",
  },
  {
    pattern: /\bstripe\s+\S+\s+(create|confirm|capture|cancel|update)\b/,
    hint: "the matching stripe.* claim (stripe.refund, stripe.payment_succeeded, …)",
  },
  {
    // A mutating curl/httpie call to a remote host. Local dev servers are
    // excluded below; a curl to api.didwork.sh/v1/verify counts as
    // verification, not a side effect.
    pattern: /\b(curl|http|xh)\b[^|;&]*(\s-X\s*(POST|PUT|PATCH|DELETE)\b|\s(--data(-\w+)?|-d|-F|--form|--json)[\s=])/i,
    hint: "the claim type matching what the request was meant to cause (email.delivered, stripe.*, …) or http.ok on the resulting state",
    exclude: /localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|\.test\b|\.local\b/i,
  },
];

const VERIFICATION_TOOL = /didwork.*did_(verify|get|watch)$/;
const VERIFICATION_CURL = /api\.didwork\.sh\/v1\/verify/;

function readStdin() {
  try {
    return JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return null;
  }
}

/** Extract tool_use blocks from one transcript entry, or []. */
function toolUses(entry) {
  const content = entry?.message?.content;
  if (!Array.isArray(content)) return [];
  return content.filter((block) => block?.type === "tool_use");
}

export function scanTranscript(lines) {
  let lastVerification = -1;
  const effects = []; // { index, command, hint }

  lines.forEach((line, index) => {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      return;
    }
    for (const use of toolUses(entry)) {
      const name = typeof use.name === "string" ? use.name : "";
      if (VERIFICATION_TOOL.test(name)) {
        lastVerification = index;
        continue;
      }
      if (name !== "Bash") continue;
      const command = typeof use.input?.command === "string" ? use.input.command : "";
      if (!command) continue;
      if (VERIFICATION_CURL.test(command)) {
        lastVerification = index;
        continue;
      }
      for (const { pattern, hint, exclude } of SIDE_EFFECTS) {
        if (!pattern.test(command)) continue;
        if (exclude && exclude.test(command)) break;
        effects.push({ index, command, hint });
        break;
      }
    }
  });

  return effects.filter((e) => e.index > lastVerification);
}

export function buildReason(unverified) {
  const seen = new Set();
  const listed = [];
  for (const { command, hint } of unverified) {
    const compact = command.replace(/\s+/g, " ").trim().slice(0, 120);
    if (seen.has(compact)) continue;
    seen.add(compact);
    listed.push(`- \`${compact}\`\n  verify with: ${hint}`);
    if (listed.length === 5) break;
  }
  return (
    "DidWork stop gate: this session ran commands whose outcomes live in " +
    "external systems, with no DidWork verification afterward:\n\n" +
    listed.join("\n") +
    "\n\nBefore finishing, call `did_verify` for each outcome and gate on the " +
    "verdict: verified → done; failed → stop and report the evidence; unknown " +
    "→ poll with `did_get`, never treat as success. If a command genuinely " +
    "produced no externally observable outcome, or DidWork cannot verify it, " +
    "state that explicitly in your final message instead of claiming success. " +
    "Never fabricate a verdict."
  );
}

function main() {
  const gate = (process.env.DIDWORK_STOP_GATE || "").toLowerCase();
  if (gate === "off" || gate === "0" || gate === "false") return;

  const input = readStdin();
  // stop_hook_active means this stop is already a continuation forced by a
  // stop hook — always allow it, or the session never ends.
  if (!input || input.stop_hook_active) return;
  if (typeof input.transcript_path !== "string") return;

  let raw;
  try {
    raw = readFileSync(input.transcript_path, "utf8");
  } catch {
    return;
  }

  const unverified = scanTranscript(raw.split("\n"));
  if (unverified.length === 0) return;

  process.stdout.write(
    JSON.stringify({ decision: "block", reason: buildReason(unverified) }),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
