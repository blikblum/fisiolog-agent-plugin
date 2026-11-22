#  FisioLog Agent Plugin

## What you can do

Query and summarize FisioLog administrative records using read-only MCP tools.

## Requirements

You need a supported client from the sections below and an account with FisioLog. Your FisioLog account must have read access to MCP (AI integration)

## Install and connect

### Claude Code

Clone `blikblum/fisiolog-agent-plugin` locally. Replace `/absolute/path/to/plugin` with the local plugin directory.

Run these commands in Claude Code.

```text
/plugin marketplace add /absolute/path/to/plugin
/plugin install fisiolog-agent@fisiolog-agent-marketplace
```

Open `/mcp`, select the bundled server, and follow the browser sign-in prompt. To disconnect, choose **Clear authentication** in the server's menu. To reconnect, select the server and sign in again. For servers Claude Code can resolve by name, you can also use `claude mcp login <server-name>` and `claude mcp logout <server-name>` from your shell. [Claude Code MCP guide](https://code.claude.com/docs/en/mcp)

### Google Antigravity Desktop

Clone `blikblum/fisiolog-agent-plugin` locally. Place the plugin directory under `~/.gemini/config/plugins/` to install it for all workspaces, or under `.agents/plugins/` in the workspace where you want to use it. [Antigravity plugins](https://antigravity.google/docs/plugins)

Open **Customizations → Installed → MCP Servers**, choose **Authenticate** next to the bundled server, and follow the browser prompt. Choose **Sign out** on the server to disconnect, then choose **Authenticate** to reconnect. [Antigravity MCP guide](https://antigravity.google/docs/mcp#authenticate-a-server)

### Google Antigravity CLI

Clone `blikblum/fisiolog-agent-plugin` locally. Replace `/absolute/path/to/plugin` with the local plugin directory.

```sh
agy plugin install /absolute/path/to/plugin
agy plugin list
```

Confirm that the list shows the plugin as enabled. In an Antigravity CLI session, use `/plugin` to manage the plugin and `/mcp` to check the bundled server's connection. Follow the browser sign-in prompt. To reconnect, use `/mcp` to clear authentication for the bundled server and sign in again when prompted. [Antigravity plugins](https://antigravity.google/docs/plugins)

### OpenAI Codex

Clone `blikblum/fisiolog-agent-plugin` locally. Replace `/absolute/path/to/plugin` with the local plugin directory.

```sh
codex plugin marketplace add /absolute/path/to/plugin
codex plugin add fisiolog-agent@fisiolog-agent-marketplace
```

In a Codex session, run `/mcp` to find the bundled server name, then run `/mcp login <server-name>` to sign in. If `codex mcp list` shows the server, you can also use `codex mcp login <server-name>` from your shell. To disconnect, run `codex mcp logout <server-name>` or use the MCP authentication controls in Codex desktop. Sign in again to reconnect. [Codex MCP guide](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) · [Codex CLI login command](https://github.com/openai/codex/issues/52253)

### ChatGPT

Add the FisioLog MCP server (`https://fisiolog-mcp-855158414410.southamerica-east1.run.app/mcp`) in the ChatGPT Plugins Directory or install the published plugin once `.app.json` is registered (see [Set up ChatGPT if supported](#set-up-chatgpt-if-supported)).

Choose **Connect** when prompted and approve access with your FisioLog account. To disconnect or reconnect, open **Settings → Apps** or **Settings → Plugins** and manage the connected account. Availability depends on your plan and workspace settings. [Manage app accounts](https://help.openai.com/en/articles/20001494-connecting-and-managing-app-accounts-in-chatgpt)

## For maintainers

### Configure OAuth when needed

Leave `oauth-overrides.json` absent when discovery supplies everything the clients need. If the provider requires public client preregistration, document it in `manualRegistration` and confirm each client's redirect URI. Add only settings the service requires. The file supports the following fields.

```json
{
  "manualRegistration": "Register public clients with each client's redirect URI in the service admin console.",
  "scopes": ["records:read"],
  "claude": {
    "clientId": "claude-public-client",
    "callbackPort": 8080,
    "scopes": ["records:read"],
    "authServerMetadataUrl": "https://auth.example.com/.well-known/openid-configuration"
  },
  "antigravity": {
    "clientId": "antigravity-public-client"
  }
}
```

Use the top-level `scopes` list when discovery leaves scopes unstated. Use `[]` if the server requires no scopes. The generator writes the applicable client-specific settings to each generated file. Keep tokens and secrets in the client or provider's credential store and out of URLs, configuration, and Git. [Claude Code OAuth overrides](https://code.claude.com/docs/en/mcp#use-pre-configured-oauth-credentials) · [Antigravity manual registration](https://antigravity.google/docs/mcp#manual-client-credentials)

### Set up ChatGPT if supported

For a local ChatGPT test, open the Plugins Directory, choose **Add custom MCP server**, enter the same HTTPS endpoint as in `mcp.json`, select OAuth, and choose **Create as a plugin**. Give the resulting `plugin_asdk_app…` ID to `@plugin-creator` to obtain the registered connection mapping. Place the resulting `.app.json` at the repository root and set `extensions["com.openai"].apps` to `"./.app.json"` in `plugin.json`. Restart ChatGPT desktop, open the shared marketplace in the Plugins Directory, and install the plugin. [ChatGPT Plugins Directory](https://chatgpt.com/plugins) · [OpenAI plugin packaging guide](https://developers.openai.com/plugins/build/plugins)

For public distribution, choose **With MCP** in the OpenAI submission portal and verify the endpoint. Supply the portal's publishing metadata and any required service-specific OAuth settings. If those settings require OpenAI's submission format, validate that package separately. [OpenAI submission guide](https://developers.openai.com/plugins/deploy/submission) · [OpenAI MCP authentication reference](https://developers.openai.com/plugins/build/plugins#configure-mcp-authentication)

### Generate and verify

From the repository root, run the following with Node.js 24 or later.

```sh
npm ci
npm run mcp:generate
npm run validate
npm run mcp:check
npm test
```

Regenerate `.mcp.json` and `mcp_config.json` whenever `mcp.json` or `oauth-overrides.json` changes. Commit both generated files with the source changes. The `mcp:check` command reports missing or stale output without writing files.

If the plugin supports Antigravity, run its validator from the repository root. Expect warnings about files intended for other clients. [Google Antigravity build guide](https://antigravity.google/docs/build-plugins/)

```sh
agy plugin validate .
```

Run `npm run oauth:check` with the real endpoint. The checker uses unauthenticated requests to verify the Bearer challenge, protected-resource metadata matching the configured resource, and metadata for the first issuer. It checks for HTTPS authorization and token endpoints, PKCE S256, client ID metadata (CIMD), dynamic client registration (DCR), or documented manual preregistration. It also checks scopes in discovery or `oauth-overrides.json`. Antigravity uses the first issuer. [MCP authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization) · [Antigravity OAuth discovery](https://antigravity.google/docs/mcp#oauth)

- **Plugin configuration** errors point to a local configuration problem. The example endpoint fails locally before any request.
- **Network** errors point to reachability or transport. **Server discovery** errors identify a problem in the hosted server's challenge or metadata.
- Before release, verify sign-in, one permitted read, and disconnect or reauthorization in each supported client. Check that each client's redirect URI works and that the server enforces the resource audience.

GitHub Actions runs offline manifest and skill validation, generated-file drift checks, and mocked OAuth tests. A separate job runs the Claude Code and Antigravity validators and installs the local marketplace plugin with Codex. Claude Code may warn about OpenAI catalog fields.

## Documentation

- [Agent Plugins specification](https://agent-plugins.org/specification)
- [Agent Skills specification](https://agentskills.io/specification)
- [Google Antigravity build guide](https://antigravity.google/docs/build-plugins/)
