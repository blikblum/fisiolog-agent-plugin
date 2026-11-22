import { pathToFileURL } from "node:url";
import { ConfigError, exampleMcpUrl, httpsUrl, isRecord, loadMcp, scopeToken } from "./lib/config.mjs";

const protectedResourcePath = "/.well-known/oauth-protected-resource";
const authorizationServerPath = "/.well-known/oauth-authorization-server";
const openIdPath = "/.well-known/openid-configuration";
const requestTimeout = 10_000;
const maxMetadataBytes = 256 * 1024;
const redirectStatuses = [301, 302, 303, 307, 308];
const authScheme = /^([!#$%&'*+.^_\x60|~0-9A-Za-z-]+)(?:[ \t]+(.*))?$/;
const authParameter = /^([!#$%&'*+.^_\x60|~0-9A-Za-z-]+)[ \t]*=[ \t]*(?:"((?:[^"\\]|\\.)*)"|([^ \t"]+))$/;

class DiscoveryError extends Error {
  constructor(message, kind = "Server discovery") {
    super(message);
    this.kind = kind;
  }
}

function bearerChallenge(header = "") {
  // A comma outside quotes separates either challenges or parameters in a challenge.
  const parts = header.match(/(?:[^",]+|"(?:[^"\\]|\\.)*")+/g) ?? [];
  const parameters = [];
  let current;
  for (const part of parts) {
    const field = part.trim();
    let parameter = authParameter.exec(field);
    if (!parameter) {
      const challenge = authScheme.exec(field);
      current = challenge?.[1].toLowerCase() === "bearer" ? new Map() : undefined;
      if (current) parameters.push(current);
      parameter = authParameter.exec(challenge?.[2] ?? "");
    }
    if (current && parameter) {
      const [, name, quoted, unquoted] = parameter;
      current.set(name.toLowerCase(), quoted?.replace(/\\(.)/g, "$1") ?? unquoted);
    }
  }
  return parameters.find((challenge) => challenge.has("resource_metadata")) ?? parameters[0];
}

async function request(fetchImpl, url, stage, options) {
  try {
    return await fetchImpl(url, {
      ...options,
      credentials: "omit",
      redirect: "manual",
      signal: AbortSignal.timeout(requestTimeout),
    });
  } catch {
    throw new DiscoveryError(stage + " could not be reached over HTTPS.", "Network");
  }
}

async function probeMcp(fetchImpl, url) {
  const stage = "The MCP endpoint";
  let response = await request(fetchImpl, url, stage, {
    headers: { Accept: "text/event-stream" },
  });
  await response.body?.cancel();
  if (response.status === 405) {
    // Streamable HTTP servers can decline GET. An initialize request checks POST without invoking tools.
    response = await request(fetchImpl, url, stage, {
      method: "POST",
      headers: { Accept: "application/json, text/event-stream", "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "oauth-discovery-check", version: "1.0.0" },
        },
      }),
    });
    await response.body?.cancel();
  }
  if (response.status !== 401) {
    const guidance = redirectStatuses.includes(response.status)
      ? " Set mcp.json to the final HTTPS endpoint."
      : "";
    throw new DiscoveryError(stage + " returned HTTP " + response.status +
      " to an unauthenticated request. Expected HTTP 401." + guidance);
  }
  const challenge = bearerChallenge(response.headers.get("www-authenticate") ?? "");
  if (!challenge) {
    throw new DiscoveryError("The MCP endpoint returned HTTP 401 without a Bearer WWW-Authenticate challenge.");
  }
  return challenge;
}

async function requestMetadata(fetchImpl, url, stage) {
  for (let redirects = 0; ; redirects++) {
    const response = await request(fetchImpl, url, stage, { headers: { Accept: "application/json" } });
    if (!redirectStatuses.includes(response.status)) return response;
    await response.body?.cancel();
    if (redirects === 3) throw new DiscoveryError(stage + " redirected too many times.");
    const location = response.headers.get("location");
    const next = location && URL.parse(location, url);
    if (!next || !httpsUrl(next.href)) {
      throw new DiscoveryError(stage + " redirected without a valid HTTPS destination.");
    }
    url = next.href;
  }
}

async function readMetadata(response, stage) {
  let text = "";
  let bytes = 0;
  const decoder = new TextDecoder();
  try {
    for await (const chunk of response.body ?? []) {
      bytes += chunk.byteLength;
      if (bytes > maxMetadataBytes) throw new DiscoveryError(stage + " exceeded 256 KiB.");
      text += decoder.decode(chunk, { stream: true });
    }
  } catch (error) {
    if (error instanceof DiscoveryError) throw error;
    throw new DiscoveryError(stage + " response could not be read.", "Network");
  }
  let metadata;
  try {
    metadata = JSON.parse(text + decoder.decode());
  } catch {
    throw new DiscoveryError(stage + " returned invalid JSON.");
  }
  if (!isRecord(metadata)) throw new DiscoveryError(stage + " must be a JSON object.");
  return metadata;
}

async function discoverMetadata(fetchImpl, urls, stage) {
  for (const url of urls) {
    const response = await requestMetadata(fetchImpl, url, stage);
    if (response.ok) return readMetadata(response, stage);
    await response.body?.cancel();
    if (response.status !== 404 && response.status !== 405) {
      throw new DiscoveryError(stage + " returned HTTP " + response.status + ".");
    }
  }
  throw new DiscoveryError(stage + " was unavailable at the expected discovery location(s).");
}

function resourceMetadataUrls(endpoint, challenge) {
  if (challenge.has("resource_metadata")) {
    const url = challenge.get("resource_metadata");
    if (!httpsUrl(url)) {
      throw new DiscoveryError("The Bearer challenge's resource_metadata must be an absolute HTTPS URL.");
    }
    return [url];
  }
  const path = endpoint.pathname === "/" ? "" : endpoint.pathname;
  const rootMetadata = endpoint.origin + protectedResourcePath;
  return path ? [rootMetadata + path, rootMetadata] : [rootMetadata];
}

function issuerMetadataUrls(issuer) {
  const path = issuer.pathname.replace(/\/$/, "");
  return [...new Set([
    issuer.origin + authorizationServerPath + path,
    issuer.origin + openIdPath + path,
    issuer.origin + path + openIdPath,
  ])];
}

function registrationMethods(metadata, overrides) {
  const methods = [];
  const cimd = metadata.client_id_metadata_document_supported;
  if (cimd !== undefined && typeof cimd !== "boolean") {
    throw new DiscoveryError("The authorization server's CIMD support flag must be a boolean.");
  }
  if (cimd === true) methods.push("CIMD advertised");
  if (metadata.registration_endpoint !== undefined) {
    if (!httpsUrl(metadata.registration_endpoint)) {
      throw new DiscoveryError("The authorization server's registration_endpoint must be an absolute HTTPS URL.");
    }
    methods.push("DCR advertised");
  }
  if (overrides.manualRegistration) methods.push("manual preregistration documented");
  if (!methods.length) {
    throw new DiscoveryError("The authorization server does not advertise CIMD or DCR. Enable one or document manual preregistration in oauth-overrides.json.");
  }
  return methods;
}

function checkedScopes(challenge, resourceMetadata, overrides) {
  const fromChallenge = challenge.has("scope") ? challenge.get("scope").split(" ") : undefined;
  const advertised = resourceMetadata.scopes_supported;
  for (const scopes of [fromChallenge, advertised]) {
    if (scopes !== undefined && (!Array.isArray(scopes) ||
        !scopes.every((scope) => typeof scope === "string" && scopeToken.test(scope)))) {
      throw new DiscoveryError("The server's advertised scopes have an invalid format.");
    }
  }
  if (fromChallenge) return { source: "Bearer challenge", count: fromChallenge.length };
  if (advertised) return { source: "protected resource metadata", count: advertised.length };
  if (overrides.scopes) return { source: "oauth-overrides.json", count: overrides.scopes.length };
  throw new DiscoveryError("Required scopes were not advertised. Set scopes in oauth-overrides.json to document the server's requirements.");
}

export async function inspectOAuth({ url, endpoint, overrides }, fetchImpl = globalThis.fetch) {
  if (endpoint.hostname === new URL(exampleMcpUrl).hostname) {
    throw new ConfigError("Replace the starter endpoint in mcp.json before checking OAuth. No request was sent.");
  }

  const challenge = await probeMcp(fetchImpl, url);
  const resource = await discoverMetadata(
    fetchImpl, resourceMetadataUrls(endpoint, challenge), "Protected Resource Metadata",
  );
  if (resource.resource !== url) {
    throw new DiscoveryError("The Protected Resource Metadata resource value must match the URL in mcp.json exactly.");
  }
  const issuers = resource.authorization_servers;
  if (!Array.isArray(issuers) || !issuers.length) {
    throw new DiscoveryError("Protected Resource Metadata must list at least one authorization server.");
  }
  const issuer = httpsUrl(issuers[0]);
  if (!issuer || issuers[0].includes("?")) {
    throw new DiscoveryError("The first authorization server issuer must be an HTTPS URL without a query or fragment.");
  }

  const metadata = await discoverMetadata(fetchImpl, issuerMetadataUrls(issuer), "Authorization Server Metadata");
  if (metadata.issuer !== issuers[0]) {
    throw new DiscoveryError("The authorization server metadata issuer does not match the advertised issuer.");
  }
  for (const field of ["authorization_endpoint", "token_endpoint"]) {
    if (!httpsUrl(metadata[field])) {
      throw new DiscoveryError("The authorization server must advertise an absolute HTTPS " + field + ".");
    }
  }
  const pkceMethods = metadata.code_challenge_methods_supported;
  if (!Array.isArray(pkceMethods) ||
      !pkceMethods.every((method) => typeof method === "string") ||
      !pkceMethods.includes("S256")) {
    throw new DiscoveryError("The authorization server does not advertise PKCE S256.");
  }
  return {
    registration: registrationMethods(metadata, overrides),
    scopes: checkedScopes(challenge, resource, overrides),
    additionalIssuers: issuers.length - 1,
  };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const { registration, scopes, additionalIssuers } = await inspectOAuth(loadMcp());
    console.log("The MCP endpoint returned a Bearer challenge. Resource and issuer match, and PKCE S256 is advertised.");
    console.log("Client registration: " + registration.join(", ") + ".");
    console.log("Scopes: " + scopes.count + " from " + scopes.source + ".");
    if (additionalIssuers) console.log("Checked the first of " + (additionalIssuers + 1) + " advertised issuers.");
    console.log("Resource parameter handling, token audience enforcement, and client sign-in require a live OAuth flow.");
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error("Plugin configuration: " + error.message);
      process.exitCode = 2;
    } else if (error instanceof DiscoveryError) {
      console.error(error.kind + ": " + error.message);
      process.exitCode = 1;
    } else {
      console.error("OAuth discovery check failed unexpectedly.");
      process.exitCode = 1;
    }
  }
}
