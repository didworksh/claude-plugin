#!/usr/bin/env node
// Exercises the Stop gate the way Claude Code does: spawn the hook with a
// Stop payload on stdin pointing at a synthetic transcript, assert on the
// decision. Run: node scripts/test-stop-gate.mjs

import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const gate = path.resolve("plugins/didwork/hooks/stop-verify-gate.mjs");
const dir = mkdtempSync(path.join(tmpdir(), "didwork-stop-gate-"));
let failures = 0;

const assistantToolUse = (name, input) =>
  JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name, input }] } });
const bash = (command) => assistantToolUse("Bash", { command });
const didVerify = () =>
  assistantToolUse("mcp__plugin_didwork_didwork__did_verify", {
    type: "github.pr_merged",
    expected: { repo: "didworksh/claude-plugin", pr: 1 },
  });
const text = (t) =>
  JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: t }] } });

function run(name, { lines, stopHookActive = false, env = {}, expectBlock, reasonHas = [] }) {
  const transcript = path.join(dir, `${name.replace(/\W+/g, "-")}.jsonl`);
  writeFileSync(transcript, lines.join("\n") + "\n");
  const payload = JSON.stringify({
    session_id: "test",
    transcript_path: transcript,
    hook_event_name: "Stop",
    stop_hook_active: stopHookActive,
  });
  const result = spawnSync("node", [gate], {
    input: payload,
    encoding: "utf8",
    env: { ...process.env, DIDWORK_STOP_GATE: "", ...env },
  });

  const problems = [];
  if (result.status !== 0) problems.push(`exit ${result.status}: ${result.stderr}`);
  const blocked = result.stdout.includes('"decision":"block"');
  if (blocked !== expectBlock) {
    problems.push(`expected ${expectBlock ? "block" : "allow"}, got ${blocked ? "block" : "allow"}`);
  }
  for (const fragment of reasonHas) {
    if (!result.stdout.includes(fragment)) problems.push(`reason missing: ${fragment}`);
  }
  if (problems.length > 0) {
    failures += 1;
    console.error(`FAIL ${name}\n  ${problems.join("\n  ")}\n  stdout: ${result.stdout}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

run("no side effects allows the stop", {
  lines: [bash("npm test"), bash("git status"), text("All tests pass.")],
  expectBlock: false,
});

run("unverified push blocks", {
  lines: [bash("git push origin main"), text("Pushed.")],
  expectBlock: true,
  reasonHas: ["git push origin main", "github.workflow_passed"],
});

run("push then did_verify allows the stop", {
  lines: [bash("git push origin main"), didVerify()],
  expectBlock: false,
});

run("verify before the side effect still blocks", {
  lines: [didVerify(), bash("gh pr merge 42 --squash")],
  expectBlock: true,
  reasonHas: ["gh pr merge", "github.pr_merged"],
});

run("keyless verify curl counts as verification", {
  lines: [
    bash("wrangler deploy"),
    bash(
      "curl -s https://api.didwork.sh/v1/verify -H 'content-type: application/json' -d '{\"type\":\"http.ok\",\"expected\":{\"url\":\"https://example.com\"}}'",
    ),
  ],
  expectBlock: false,
});

run("mutating curl to a remote host blocks", {
  lines: [bash("curl -X POST https://api.stripe.com/v1/refunds -d payment_intent=pi_123")],
  expectBlock: true,
  reasonHas: ["stripe"],
});

run("mutating curl to localhost is ignored", {
  lines: [bash("curl -X POST http://localhost:3000/api/seed -d '{}'")],
  expectBlock: false,
});

run("deploy blocks with a deploy hint", {
  lines: [bash("npx wrangler deploy"), text("Deployed to production.")],
  expectBlock: true,
  reasonHas: ["wrangler deploy", "http.ok"],
});

run("stop_hook_active always allows", {
  lines: [bash("git push origin main")],
  stopHookActive: true,
  expectBlock: false,
});

run("DIDWORK_STOP_GATE=off disables the gate", {
  lines: [bash("git push origin main")],
  env: { DIDWORK_STOP_GATE: "off" },
  expectBlock: false,
});

run("unparseable transcript lines fail open", {
  lines: ["not json at all", "{\"half\":", bash("npm test")],
  expectBlock: false,
});

run("npm publish blocks", {
  lines: [bash("npm publish --access public")],
  expectBlock: true,
  reasonHas: ["registry"],
});

run("deploy keywords inside a heredoc body are data, not a deploy", {
  lines: [
    bash(
      [
        "mkdir -p test/fixtures && cat > test/fixtures/ops.ts <<'EOF'",
        "server.registerTool(\"deploy\", {}, async () => {",
        "  execSync(\"vercel --prod\");",
        "  execSync(\"npm publish --access public\");",
        "  execSync(\"git push origin main\");",
        "});",
        "EOF",
        "npm test",
      ].join("\n"),
    ),
    text("Fixtures written."),
  ],
  expectBlock: false,
});

run("a real deploy after a heredoc still blocks", {
  lines: [
    bash(["cat > notes.md <<EOF", "Deploy with: wrangler deploy", "EOF", "npx wrangler deploy"].join("\n")),
  ],
  expectBlock: true,
  reasonHas: ["wrangler deploy"],
});

run("the heredoc operator line itself is still matched", {
  lines: [bash(["git push origin main && cat <<EOF", "done", "EOF"].join("\n"))],
  expectBlock: true,
  reasonHas: ["git push origin main"],
});

run("several heredocs on one line skip both bodies in order", {
  lines: [
    bash(
      ["cat <<A > a.txt; cat <<\"B\" > b.txt", "npm publish", "A", "vercel --prod", "B", "echo ok"].join("\n"),
    ),
  ],
  expectBlock: false,
});

run("<<- allows an indented terminator", {
  lines: [bash(["cat <<-EOF", "\tterraform apply", "\tEOF", "ls"].join("\n"))],
  expectBlock: false,
});

run("an unterminated heredoc swallows the rest", {
  lines: [bash(["cat <<'EOF'", "fly deploy", "npm publish"].join("\n"))],
  expectBlock: false,
});

run("a here-string is not a heredoc", {
  lines: [bash("grep -c x <<< \"hello\"; git push origin main")],
  expectBlock: true,
  reasonHas: ["git push origin main"],
});

// Missing transcript: gate must allow.
{
  const payload = JSON.stringify({
    session_id: "test",
    transcript_path: path.join(dir, "does-not-exist.jsonl"),
    hook_event_name: "Stop",
    stop_hook_active: false,
  });
  const result = spawnSync("node", [gate], { input: payload, encoding: "utf8" });
  if (result.status !== 0 || result.stdout.includes("block")) {
    failures += 1;
    console.error(`FAIL missing transcript fails open\n  stdout: ${result.stdout}`);
  } else {
    console.log("ok   missing transcript fails open");
  }
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nall stop-gate tests passed");
