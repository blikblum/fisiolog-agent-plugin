# AI Plugin Starter

Use this repository to build a plugin with shared agent skills and tools from your hosted HTTPS MCP server. The starter includes packaging for Claude Code, Google Antigravity Desktop and CLI, OpenAI Codex, and ChatGPT. It includes a sample skill, an MCP configuration generator, and validation checks. Each client handles OAuth sign-in for the service.

## Bootstrap a plugin

1. Create a new repository from this starter and open its checkout in your coding agent. Use Node.js 24 or later to run the development checks.
2. Ask the agent to use the [bootstrap-plugin skill](.agents/skills/bootstrap-plugin/SKILL.md). Provide the plugin name, version, description, author, and marketplace details. Include the hosted Streamable HTTP MCP URL, supported workflows, target clients, and any account or permission requirements you know.

You can start with this prompt.

```text
Use .agents/skills/bootstrap-plugin/SKILL.md to bootstrap this checkout.
Plugin: <display name, identifier, version, description, and author>
Marketplace: <name and owner>
MCP endpoint: <hosted HTTPS URL>
Workflows: <tasks the plugin should support>
Clients: <where users will install the plugin>
```

The skill configures the plugin and uses [README.template](README.template) to write the new plugin's README. The template also documents optional OAuth settings, ChatGPT registration, and release checks.
