---
name: bootstrap-plugin
description: Configure a new plugin from this starter when asked to bootstrap a checkout. Set up manifests, the marketplace, the hosted OAuth MCP connection, bundled skills, and the plugin README.
---

# Bootstrap a plugin

Work in the checkout intended to become the new plugin. Read `README.template` in the repository root before editing the project.

## Gather the inputs

Use project files and supplied service documentation first. Confirm the plugin display name, kebab-case identifier, version, description, author, marketplace name and owner, target clients, and installation sources. Find the public HTTPS Streamable HTTP MCP endpoint, supported tools and workflows, and the account access, permissions, and OAuth scopes they require. Ask for missing details when they determine the configuration or workflow. Complete the steps supported by confirmed inputs and report what remains.

## Configure the plugin

1. Set the name, semantic version, description, and author in `plugin.json`, `.claude-plugin/plugin.json`, and `.antigravity-plugin/plugin.json`. Keep the identifier, version, and description in sync. Update the marketplace name, owner, and description in `.claude-plugin/marketplace.json`. Keep one entry pointing to `./`, with the same name and description as the root manifest and the required category and policies.
2. Set the confirmed endpoint in `mcp.json`. Keep one `streamable-http` server and preserve its key after release. The starter key is `main`. Keep credentials and configured HTTP headers out of the portable MCP file. Use **Configure OAuth when needed** in `README.template` for public-client overrides.
3. Adapt or replace `skills/summarize-mcp-record/SKILL.md` using confirmed tools and permissions. Keep at least one bundled skill under `skills/<skill-name>/SKILL.md`, with a matching kebab-case `name` and a `description` that says when to use it. Refer to tools by purpose and explain what to do if the service or permissions are unavailable.
4. For a plugin that supports ChatGPT, follow **Set up ChatGPT if supported** in `README.template`. Use the registered connection mapping for the configured endpoint.

## Write the plugin README

Use `README.template` as the source for the derived plugin's `README.md`. Fill the placeholders and remove the template comments. Use the manifest and marketplace names in install commands. Describe concrete workflows, account requirements, and how users obtain the plugin. Keep installation sections for the supported clients and document the verified reconnect steps for Antigravity CLI when supported. For ChatGPT, give users the install path for the distribution they can access.

## Verify the plugin

Follow **Generate and verify** in `README.template` to generate the MCP client files and run the offline checks. Run live OAuth discovery once the real endpoint is configured. Verify install, sign-in, a permitted read, and disconnect or reauthorization for the supported clients when available. Report incomplete configuration and any live checks still pending.
