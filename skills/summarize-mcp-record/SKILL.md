---
name: summarize-mcp-record
description: Retrieve a record from this plugin's remote MCP server and summarize it when the user gives a record ID, link, or search term.
---

# Summarize a record

1. Identify the record from the user's ID, link, or search term. If a search matches several records, ask which one to use.
2. Find a read-only tool from this plugin's MCP connection that can look up the record. The user needs to authorize the service in the client and have permission to read the record.
3. Retrieve the record and summarize its relevant details. Include its source link or ID if the tool returned one, and call out any requested details the record did not contain.
4. If the service requires sign-in, direct the user to the client's MCP authentication controls and resume after they connect. If the service, read tool, or permission is unavailable, explain what blocked retrieval and ask the user to provide the record if they still want a summary.
