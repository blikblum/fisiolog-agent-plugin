import assert from "node:assert/strict";
import { test } from "node:test";
import { inspectOAuth } from "../scripts/check-oauth.mjs";
import { exampleMcpUrl, loadMcp } from "../scripts/lib/config.mjs";

const url = "https://mcp.example.test/services/mcp";
const resourceUrl = "https://mcp.example.test/metadata?origin=a,b";
const resourceWellKnown = "https://mcp.example.test/.well-known/oauth-protected-resource";
const issuer = "https://auth.example.test/tenant";
const metadataUrl = "https://auth.example.test/.well-known/oauth-authorization-server/tenant";
const oidcInserted = "https://auth.example.test/.well-known/openid-configuration/tenant";
const oidcAppended = issuer + "/.well-known/openid-configuration";

const resource = {
  resource: url,
  authorization_servers: [issuer],
  scopes_supported: ["records:read"],
};
const authorizationServer = {
  issuer,
  authorization_endpoint: issuer + "/authorize",
  token_endpoint: issuer + "/token",
  code_challenge_methods_supported: ["S256"],
  client_id_metadata_document_supported: true,
};
const defaultChallenge = 'Bearer resource_metadata="' + resourceUrl + '"';

function challengeResponse(header = defaultChallenge) {
  return new Response(null, { status: 401, headers: { "WWW-Authenticate": header } });
}

function mockDiscover({ mcp, prm, as, overrides = {}, routes = [] } = {}) {
  const calls = [];
  const responses = new Map([
    ["GET " + url, mcp ?? (() => challengeResponse())],
    ["GET " + resourceUrl, () => Response.json(prm ?? resource)],
    ["GET " + metadataUrl, () => Response.json(as ?? authorizationServer)],
    ...routes,
  ]);
  const fetchImpl = async (target, options) => {
    const name = (options.method ?? "GET") + " " + target;
    calls.push({ name, options });
    return responses.get(name)?.() ?? new Response(null, { status: 404 });
  };
  return {
    calls,
    inspect: () => inspectOAuth({ url, endpoint: new URL(url), overrides }, fetchImpl),
  };
}

test("uses the Bearer challenge metadata and scopes even with other challenges present", async () => {
  const { inspect, calls } = mockDiscover({
    mcp: () => challengeResponse(
      'Basic realm="alt,Bearer", ' + defaultChallenge +
      ', other.field="extension", scope="records:read projects:list", Basic realm="last"',
    ),
  });
  assert.deepEqual(await inspect(), {
    registration: ["CIMD advertised"],
    scopes: { source: "Bearer challenge", count: 2 },
    additionalIssuers: 0,
  });
  assert.deepEqual(calls.map(({ name }) => name), [
    "GET " + url, "GET " + resourceUrl, "GET " + metadataUrl,
  ]);
  for (const { options } of calls) {
    assert.equal(options.credentials, "omit");
    assert.equal(options.redirect, "manual");
    assert.equal(new Headers(options.headers).get("Authorization"), null);
  }
});

test("probes POST initialize after GET 405 and tries standard metadata locations in order", async () => {
  const { inspect, calls } = mockDiscover({
    mcp: () => new Response(null, { status: 405 }),
    routes: [
      ["POST " + url, () => challengeResponse('Bearer realm="mcp"')],
      ["GET " + resourceWellKnown, () => Response.json(resource)],
      ["GET " + metadataUrl, () => new Response(null, { status: 404 })],
      ["GET " + oidcAppended, () => Response.json({
        ...authorizationServer,
        client_id_metadata_document_supported: false,
        registration_endpoint: issuer + "/register",
      })],
    ],
  });
  assert.deepEqual(await inspect(), {
    registration: ["DCR advertised"],
    scopes: { source: "protected resource metadata", count: 1 },
    additionalIssuers: 0,
  });
  assert.deepEqual(calls.map(({ name }) => name), [
    "GET " + url, "POST " + url, "GET " + resourceWellKnown + "/services/mcp",
    "GET " + resourceWellKnown, "GET " + metadataUrl, "GET " + oidcInserted, "GET " + oidcAppended,
  ]);
  assert.equal(JSON.parse(calls[1].options.body).method, "initialize");
  assert.equal(new Headers(calls[1].options.headers).get("Authorization"), null);
});

test("accepts documented manual registration and verifies the first advertised issuer", async () => {
  const { inspect } = mockDiscover({
    prm: { ...resource, authorization_servers: [issuer, issuer + "-other"], scopes_supported: undefined },
    as: { ...authorizationServer, client_id_metadata_document_supported: false },
    overrides: { manualRegistration: "Create a public client in the admin console.", scopes: [] },
  });
  assert.deepEqual(await inspect(), {
    registration: ["manual preregistration documented"],
    scopes: { source: "oauth-overrides.json", count: 0 },
    additionalIssuers: 1,
  });
});

test("rejects invalid or incomplete OAuth discovery", async (t) => {
  const cases = [
    ["401 not sent", { mcp: () => new Response(null, { status: 200 }) }, /Expected HTTP 401/],
    ["wrong challenge", { mcp: () => challengeResponse('Basic realm="mcp"') }, /without a Bearer/],
    ["invalid metadata location", { mcp: () => challengeResponse('Bearer resource_metadata="http://example.test"') }, /resource_metadata must be/],
    ["missing protected resource metadata", {
      routes: [["GET " + resourceUrl, () => new Response(null, { status: 404 })]],
    }, /Protected Resource Metadata was unavailable/],
    ["wrong protected resource", { prm: { ...resource, resource: url + "/" } }, /must match the URL/],
    ["missing authorization server", { prm: { ...resource, authorization_servers: [] } }, /at least one authorization server/],
    ["invalid issuer URL", { prm: { ...resource, authorization_servers: [issuer + "?tenant=two"] } }, /issuer must be an HTTPS URL/],
    ["unreachable authorization server", {
      routes: [["GET " + metadataUrl, () => new Response(null, { status: 404 })]],
    }, /Authorization Server Metadata was unavailable/],
    ["malformed authorization server metadata", {
      routes: [["GET " + metadataUrl, () => new Response("not a JSON document")]],
    }, /Authorization Server Metadata returned invalid JSON/],
    ["mismatched issuer", { as: { ...authorizationServer, issuer: issuer + "/" } }, /issuer does not match/],
    ["insecure token endpoint", { as: { ...authorizationServer, token_endpoint: "http://wrong.example.test" } }, /HTTPS token_endpoint/],
    ["missing authorization endpoint", { as: { ...authorizationServer, authorization_endpoint: undefined } }, /HTTPS authorization_endpoint/],
    ["missing PKCE", { as: { ...authorizationServer, code_challenge_methods_supported: undefined } }, /PKCE S256/],
    ["plain PKCE only", { as: { ...authorizationServer, code_challenge_methods_supported: ["plain"] } }, /PKCE S256/],
    ["missing registration", { as: { ...authorizationServer, client_id_metadata_document_supported: false } }, /does not advertise CIMD or DCR/],
    ["invalid DCR endpoint", { as: { ...authorizationServer, registration_endpoint: "relative" } }, /HTTPS URL/],
    ["missing scopes", { prm: { ...resource, scopes_supported: undefined } }, /Required scopes were not advertised/],
    ["malformed scope list", { prm: { ...resource, scopes_supported: ["one scope"] } }, /scopes have an invalid format/],
  ];
  for (const [name, input, expected] of cases) {
    await t.test(name, async () => {
      await assert.rejects(mockDiscover(input).inspect, { kind: "Server discovery", message: expected });
    });
  }
});

test("follows only bounded HTTPS metadata redirects", async () => {
  const destination = "https://mcp.example.test/public/metadata";
  const redirected = mockDiscover({
    routes: [
      ["GET " + resourceUrl, () => new Response(null, { status: 302, headers: { Location: "/public/metadata" } })],
      ["GET " + destination, () => Response.json(resource)],
    ],
  });
  await redirected.inspect();
  assert.equal(redirected.calls[2].name, "GET " + destination);

  const insecure = mockDiscover({
    routes: [
      ["GET " + resourceUrl, () => new Response(null, { status: 302, headers: { Location: "http://example.test" } })],
    ],
  });
  await assert.rejects(insecure.inspect, /redirected without a valid HTTPS destination/);
  assert.equal(insecure.calls.length, 2);
});

test("keeps configuration and network failures distinct and redacts network details", async () => {
  const connection = loadMcp();
  let requests = 0;
  const fetchImpl = async () => {
    requests++;
    throw new Error("an untrusted network message containing a secret");
  };
  await assert.rejects(inspectOAuth({
    ...connection, url: exampleMcpUrl, endpoint: new URL(exampleMcpUrl),
  }, fetchImpl), /Replace the starter endpoint/);
  assert.equal(requests, 0);

  await assert.rejects(inspectOAuth({ ...connection, url, endpoint: new URL(url) }, fetchImpl), {
    kind: "Network", message: "The MCP endpoint could not be reached over HTTPS.",
  });
  assert.equal(requests, 1);
});
