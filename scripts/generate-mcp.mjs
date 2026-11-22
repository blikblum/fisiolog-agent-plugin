import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ConfigError, loadMcp, readText, repoRoot } from "./lib/config.mjs";

export function renderMcp({ key, url, overrides }) {
  const claude = { type: "http", url };
  const antigravity = { serverUrl: url };
  if (overrides.claude) {
    const { clientId, callbackPort, scopes, authServerMetadataUrl } = overrides.claude;
    claude.oauth = { clientId, callbackPort, scopes, authServerMetadataUrl };
  }
  if (overrides.antigravity) {
    antigravity.oauth = { clientId: overrides.antigravity.clientId };
  }
  return {
    ".mcp.json": JSON.stringify({ mcpServers: { [key]: claude } }, null, 2) + "\n",
    "mcp_config.json": JSON.stringify({ mcpServers: { [key]: antigravity } }, null, 2) + "\n",
  };
}

export function synchronizeMcp({ root = repoRoot, check = false } = {}) {
  const expectedFiles = renderMcp(loadMcp(root));
  const changes = [];
  for (const [name, expected] of Object.entries(expectedFiles)) {
    const current = readText(root, name, { optional: true });
    if (current !== expected) {
      changes.push({ name, expected, status: current === undefined ? "missing" : "outdated" });
    }
  }
  if (!check) {
    for (const { name, expected } of changes) {
      try {
        writeFileSync(join(root, name), expected);
      } catch (error) {
        throw new ConfigError(name + " could not be written (" + error.code + ").");
      }
    }
  }
  return changes.map(({ name, status }) => ({ name, status }));
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const args = process.argv.slice(2);
    const check = args[0] === "--check";
    if (args.length !== Number(check)) {
      throw new ConfigError("Usage: node scripts/generate-mcp.mjs [--check]");
    }
    const changes = synchronizeMcp({ check });
    if (check && changes.length) {
      for (const { name, status } of changes) console.error(name + " is " + status + ".");
      console.error("Run npm run mcp:generate and include the generated files in your change.");
      process.exitCode = 1;
    } else {
      for (const { name } of changes) console.log("Generated " + name + ".");
      if (!changes.length) console.log("MCP configurations are up to date.");
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
