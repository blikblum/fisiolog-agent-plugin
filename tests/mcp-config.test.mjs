import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { renderMcp, synchronizeMcp } from "../scripts/generate-mcp.mjs";
import { loadMcp } from "../scripts/lib/config.mjs";

const schema = "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json";
const serverKey = "records-api";
const endpoint = "https://MCP.example.test:8443/v1/records%2Fpublic/?workspace=demo";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "plugin-mcp-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const config = {
    $schema: schema,
    mcpServers: { [serverKey]: { type: "streamable-http", url: endpoint } },
  };
  writeJson(root, "mcp.json", config);
  return { root, config, server: config.mcpServers[serverKey] };
}

function writeJson(root, name, value) {
  writeFileSync(join(root, name), JSON.stringify(value));
}

test("generates exact platform MCP JSON from one canonical server", (t) => {
  const { root } = fixture(t);
  const connection = loadMcp(root);
  assert.equal(connection.key, serverKey);
  assert.equal(connection.url, endpoint);

  const outputs = renderMcp(connection);
  assert.deepEqual(outputs, {
    ".mcp.json": [
      "{",
      '  "mcpServers": {',
      '    "records-api": {',
      '      "type": "http",',
      '      "url": "' + endpoint + '"',
      "    }",
      "  }",
      "}",
      "",
    ].join("\n"),
    "mcp_config.json": [
      "{",
      '  "mcpServers": {',
      '    "records-api": {',
      '      "serverUrl": "' + endpoint + '"',
      "    }",
      "  }",
      "}",
      "",
    ].join("\n"),
  });
});

test("check reports both missing and stale files without changing either", (t) => {
  const { root } = fixture(t);
  const stalePath = join(root, "mcp_config.json");
  const stale = "{}\n";
  writeFileSync(stalePath, stale);
  assert.deepEqual(synchronizeMcp({ root, check: true }), [
    { name: ".mcp.json", status: "missing" },
    { name: "mcp_config.json", status: "outdated" },
  ]);
  assert.throws(() => readFileSync(join(root, ".mcp.json")), { code: "ENOENT" });
  assert.equal(readFileSync(stalePath, "utf8"), stale);

  assert.equal(synchronizeMcp({ root }).length, 2);
  const expected = readFileSync(stalePath, "utf8");
  const modified = statSync(stalePath).mtimeMs;
  assert.deepEqual(synchronizeMcp({ root, check: true }), []);
  assert.deepEqual(synchronizeMcp({ root }), []);
  assert.equal(readFileSync(stalePath, "utf8"), expected);
  assert.equal(statSync(stalePath).mtimeMs, modified);
});

test("renders only documented client overrides in fixed field order", (t) => {
  const { root } = fixture(t);
  const overrides = {
    antigravity: { clientId: "antigravity-public-client" },
    claude: {
      scopes: ["records:read"],
      authServerMetadataUrl: "https://auth.example.test/metadata",
      callbackPort: 8080,
      clientId: "claude-public-client",
    },
    manualRegistration: "Register a separate public client with each client's callback URI.",
    scopes: ["records:read"],
  };
  writeJson(root, "oauth-overrides.json", overrides);
  const outputs = renderMcp(loadMcp(root));
  assert.deepEqual(JSON.parse(outputs[".mcp.json"]).mcpServers[serverKey].oauth, overrides.claude);
  assert.deepEqual(JSON.parse(outputs["mcp_config.json"]).mcpServers[serverKey].oauth, overrides.antigravity);
  assert.doesNotMatch(Object.values(outputs).join(""), /secret|authorization|manualRegistration/i);
  writeJson(root, "oauth-overrides.json", {
    ...overrides,
    claude: Object.fromEntries(Object.entries(overrides.claude).reverse()),
  });
  assert.deepEqual(renderMcp(loadMcp(root)), outputs);
});

test("reports missing, malformed, or schema-invalid canonical configuration", async (t) => {
  await t.test("missing", (t) => {
    const { root } = fixture(t);
    rmSync(join(root, "mcp.json"));
    assert.throws(() => loadMcp(root), /mcp\.json could not be read \(ENOENT\)/);
  });
  await t.test("malformed", (t) => {
    const { root } = fixture(t);
    writeFileSync(join(root, "mcp.json"), '{ "clientSecret": "sensitive-value"');
    assert.throws(() => loadMcp(root), { message: "mcp.json contains malformed JSON." });
  });
  const cases = [
    ["wrong schema", ({ config }) => { config.$schema = "other"; }, /schema validation/],
    ["unknown root property", ({ config }) => { config.other = true; }, /schema validation/],
    ["empty server list", ({ config }) => { config.mcpServers = {}; }, /exactly one/],
    ["multiple servers", ({ config, server }) => { config.mcpServers.other = server; }, /exactly one/],
    ["unstable key", ({ config, server }) => { config.mcpServers = { "a b": server }; }, /server key/],
    ["unsupported transport", ({ server }) => { server.type = "sse"; }, /streamable-http/],
    ["local transport", ({ config }) => {
      config.mcpServers[serverKey] = { type: "stdio", command: "local-process" };
    }, /streamable-http/],
    ["insecure URL", ({ server }) => { server.url = "http://mcp.example.test/mcp"; }, /HTTPS URL/],
    ["embedded credentials", ({ server }) => { server.url = "https://user:secret@example.test/mcp"; }, /without credentials/],
    ["credential in query", ({ server }) => { server.url = endpoint + "&access_token=secret"; }, /query string/],
    ["fragment", ({ server }) => { server.url = endpoint + "#fragment"; }, /fragment/],
    ["HTTP headers", ({ server }) => { server.headers = { Authorization: "Bearer sample" }; }, /HTTP headers/],
    ["OpenAI-only field", ({ server }) => { server.extensions = { "com.openai": {} }; }, /schema validation/],
  ];
  for (const [name, change, expected] of cases) {
    await t.test(name, (t) => {
      const files = fixture(t);
      change(files);
      writeJson(files.root, "mcp.json", files.config);
      assert.throws(() => synchronizeMcp({ root: files.root }), expected);
      assert.throws(() => readFileSync(join(files.root, ".mcp.json")), { code: "ENOENT" });
    });
  }
});

test("rejects invalid OAuth overrides before generating any files", async (t) => {
  const cases = [
    [null, /schema validation/],
    [{ antigravity: { clientId: "public-id" } }, /manualRegistration note/],
    [{ claude: { clientSecret: "sensitive-value" } }, /schema validation/],
    [{ antigravity: { clientId: "public-id", refreshToken: "sensitive-value" } }, /schema validation/],
    [{ claude: { callbackPort: 0 } }, /schema validation/],
    [{ claude: { authServerMetadataUrl: "http://issuer.example.test" } }, /HTTPS URL/],
    [{ scopes: ["one scope"] }, /schema validation/],
  ];
  for (const [index, [value, expected]] of cases.entries()) {
    await t.test("invalid override " + (index + 1), (t) => {
      const { root } = fixture(t);
      writeJson(root, "oauth-overrides.json", value);
      assert.throws(() => synchronizeMcp({ root }), expected);
      assert.throws(() => readFileSync(join(root, "mcp_config.json")), { code: "ENOENT" });
    });
  }
});
