import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import mcpSchema from "../../schemas/mcp.schema.json" with { type: "json" };

export const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
export const exampleMcpUrl = "https://mcp.example.com/mcp";
export const scopeToken = /^[\x21\x23-\x5b\x5d-\x7e]+$/;
export const kebabCase = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const ajv = new Ajv2020({ allErrors: true, ownProperties: true });
const validateMcp = ajv.compile(mcpSchema);
const nonemptyString = { type: "string", pattern: "\\S" };
const scopeList = {
  type: "array",
  uniqueItems: true,
  items: { type: "string", pattern: scopeToken.source },
};
const validateOverrides = ajv.compile({
  type: "object",
  additionalProperties: false,
  properties: {
    manualRegistration: nonemptyString,
    scopes: scopeList,
    claude: {
      type: "object",
      minProperties: 1,
      additionalProperties: false,
      properties: {
        clientId: nonemptyString,
        callbackPort: { type: "integer", minimum: 1, maximum: 65535 },
        scopes: { ...scopeList, minItems: 1 },
        authServerMetadataUrl: nonemptyString,
      },
    },
    antigravity: {
      type: "object",
      additionalProperties: false,
      required: ["clientId"],
      properties: { clientId: nonemptyString },
    },
  },
});

export class ConfigError extends Error {}

export function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function readText(root, name, { optional = false } = {}) {
  try {
    return readFileSync(join(root, name), "utf8");
  } catch (error) {
    if (optional && error.code === "ENOENT") return undefined;
    throw new ConfigError(name + " could not be read (" + error.code + ").");
  }
}

export function readJson(root, name, options) {
  const content = readText(root, name, options);
  if (content === undefined) return undefined;
  try {
    return JSON.parse(content);
  } catch {
    throw new ConfigError(name + " contains malformed JSON.");
  }
}

export function checkSchema(schemaOrValidator, value, name) {
  const validate = typeof schemaOrValidator === "function"
    ? schemaOrValidator
    : ajv.compile(schemaOrValidator);
  if (validate(value)) return;
  const errors = validate.errors.map(({ instancePath, message }) =>
    (instancePath || "/") + " " + message);
  throw new ConfigError(name + " failed schema validation.\n  " + errors.join("\n  "));
}

export function httpsUrl(value) {
  if (typeof value !== "string" || !/^https:\/\/[^/?#]+/i.test(value) ||
      /[\s\\#\x00-\x1f\x7f]/.test(value)) return undefined;
  const url = URL.parse(value);
  if (!url || url.username || url.password || /^https:\/\/[^/?#]*@/i.test(value)) {
    return undefined;
  }
  return url;
}

const credentialQuery = /^(?:authorization|bearer|token|(?:access|refresh|id|oauth)token|clientsecret|apikey|password|signature|sig|code)$/i;

function configUrl(value, name) {
  const url = httpsUrl(value);
  if (!url) {
    throw new ConfigError(name + " must be an absolute HTTPS URL without credentials or a fragment.");
  }
  for (const key of url.searchParams.keys()) {
    if (credentialQuery.test(key.replace(/[-_]/g, ""))) {
      throw new ConfigError(name + " must not include credentials in the query string.");
    }
  }
  return url;
}

export function loadMcp(root = repoRoot) {
  const config = readJson(root, "mcp.json");
  checkSchema(validateMcp, config, "mcp.json");
  const servers = Object.entries(config.mcpServers);
  if (servers.length !== 1) {
    throw new ConfigError("mcp.json must define exactly one MCP server.");
  }
  const [[key, server]] = servers;
  if (!/^[A-Za-z0-9_-]+$/.test(key)) {
    throw new ConfigError("The MCP server key may contain only letters, digits, hyphens, and underscores.");
  }
  if (server.type !== "streamable-http") {
    throw new ConfigError("The MCP server must use the streamable-http transport.");
  }
  if (Object.hasOwn(server, "headers")) {
    throw new ConfigError("mcp.json must use OAuth discovery without configured HTTP headers.");
  }
  const endpoint = configUrl(server.url, "The MCP server URL");

  const overrides = readJson(root, "oauth-overrides.json", { optional: true });
  const oauth = overrides === undefined ? {} : overrides;
  checkSchema(validateOverrides, oauth, "oauth-overrides.json");
  if ((oauth.claude?.clientId || oauth.antigravity?.clientId) &&
      !oauth.manualRegistration) {
    throw new ConfigError("A public OAuth client ID requires a manualRegistration note in oauth-overrides.json.");
  }
  if (oauth.claude?.authServerMetadataUrl) {
    configUrl(oauth.claude.authServerMetadataUrl, "The Claude OAuth metadata URL");
  }
  return { key, url: server.url, endpoint, overrides: oauth };
}
