#!/usr/bin/env node
// Validates the Claude Code plugin marketplace layout: manifests parse, plugin
// sources exist, component frontmatter is present, referenced files resolve.

import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = process.cwd();
const errors = [];

const namePattern = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

async function pathExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath, context) {
  let raw;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch {
    errors.push(`${context} is missing: ${filePath}`);
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    errors.push(`${context} contains invalid JSON (${filePath}): ${error.message}`);
    return null;
  }
}

function parseFrontmatter(content) {
  const normalized = content.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) return null;
  const closing = normalized.indexOf("\n---\n", 4);
  if (closing === -1) return null;
  const fields = {};
  for (const line of normalized.slice(4, closing).split("\n")) {
    const sep = line.indexOf(":");
    if (sep === -1) continue;
    fields[line.slice(0, sep).trim()] = line.slice(sep + 1).trim();
  }
  return fields;
}

async function walkFiles(dirPath) {
  const files = [];
  const stack = [dirPath];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(entryPath);
      else if (entry.isFile()) files.push(entryPath);
    }
  }
  return files;
}

async function requireFrontmatter(filePath, component, requiredKeys, pluginName) {
  const fields = parseFrontmatter(await fs.readFile(filePath, "utf8"));
  const rel = path.relative(repoRoot, filePath);
  if (!fields) {
    errors.push(`${pluginName}: ${component} file missing YAML frontmatter: ${rel}`);
    return;
  }
  for (const key of requiredKeys) {
    if (!fields[key]) {
      errors.push(`${pluginName}: ${component} file missing "${key}" in frontmatter: ${rel}`);
    }
  }
}

async function validatePlugin(pluginDir, pluginName) {
  const manifest = await readJson(
    path.join(pluginDir, ".claude-plugin", "plugin.json"),
    `${pluginName} plugin manifest`,
  );
  if (!manifest) return;
  if (typeof manifest.name !== "string" || !namePattern.test(manifest.name)) {
    errors.push(`${pluginName}: "name" in plugin.json must be lowercase kebab-case.`);
  }
  if (manifest.name && manifest.name !== pluginName) {
    errors.push(`${pluginName}: marketplace entry name does not match plugin.json name ("${manifest.name}").`);
  }

  const skillsDir = path.join(pluginDir, "skills");
  if (await pathExists(skillsDir)) {
    for (const file of await walkFiles(skillsDir)) {
      if (path.basename(file) === "SKILL.md") {
        await requireFrontmatter(file, "skill", ["name", "description"], pluginName);
      }
    }
  }

  const agentsDir = path.join(pluginDir, "agents");
  if (await pathExists(agentsDir)) {
    for (const file of await walkFiles(agentsDir)) {
      if (file.endsWith(".md")) {
        await requireFrontmatter(file, "agent", ["name", "description"], pluginName);
      }
    }
  }

  const commandsDir = path.join(pluginDir, "commands");
  if (await pathExists(commandsDir)) {
    for (const file of await walkFiles(commandsDir)) {
      if (file.endsWith(".md")) {
        await requireFrontmatter(file, "command", ["description"], pluginName);
      }
    }
  }

  const hooksPath = path.join(pluginDir, "hooks", "hooks.json");
  if (await pathExists(hooksPath)) {
    const hooks = await readJson(hooksPath, `${pluginName} hooks config`);
    if (hooks) {
      for (const entries of Object.values(hooks.hooks ?? {})) {
        for (const entry of entries) {
          for (const hook of entry.hooks ?? []) {
            if (typeof hook.command !== "string") continue;
            const resolved = hook.command.replace("${CLAUDE_PLUGIN_ROOT}", pluginDir);
            if (!(await pathExists(resolved))) {
              errors.push(`${pluginName}: hook command references missing file "${hook.command}".`);
            }
          }
        }
      }
    }
  }

  const mcpPath = path.join(pluginDir, ".mcp.json");
  if (await pathExists(mcpPath)) {
    await readJson(mcpPath, `${pluginName} MCP config`);
  }
}

async function main() {
  const marketplace = await readJson(
    path.join(repoRoot, ".claude-plugin", "marketplace.json"),
    "Marketplace manifest",
  );
  if (!marketplace) return summarize();

  if (typeof marketplace.name !== "string" || !namePattern.test(marketplace.name)) {
    errors.push('Marketplace "name" must be lowercase kebab-case.');
  }
  if (!marketplace.owner?.name) {
    errors.push('Marketplace "owner.name" is required.');
  }
  if (!Array.isArray(marketplace.plugins) || marketplace.plugins.length === 0) {
    errors.push('Marketplace "plugins" must be a non-empty array.');
    return summarize();
  }

  for (const entry of marketplace.plugins) {
    if (typeof entry?.name !== "string" || !namePattern.test(entry.name)) {
      errors.push("Every marketplace plugin entry needs a lowercase kebab-case name.");
      continue;
    }
    const pluginDir = path.join(repoRoot, entry.source ?? "");
    if (!(await pathExists(pluginDir))) {
      errors.push(`${entry.name}: source directory is missing: ${entry.source}`);
      continue;
    }
    await validatePlugin(pluginDir, entry.name);
  }

  summarize();
}

function summarize() {
  if (errors.length > 0) {
    console.error("Validation failed:");
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log("Validation passed.");
}

await main();
