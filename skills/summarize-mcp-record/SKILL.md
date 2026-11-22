---
name: summarize-mcp-record
description: Retrieve an administrative record from FisioLog's remote MCP server and summarize it when the user gives a record ID, link, or search term.
---

# Summarize a FisioLog record

1. Identify the FisioLog record from the user's ID, link, or search term. If a search matches several records, ask which one to use.
2. Find a read-only tool from this plugin's FisioLog MCP connection that can look up the record. The user needs to authorize FisioLog in the client with `fisiolog:read` access and have permission to read the record.
3. Retrieve the record and summarize its relevant details. Include its source link or ID if the tool returned one, and call out any requested details the record did not contain.
4. If FisioLog requires sign-in or reauthorization, direct the user to the client's MCP authentication controls and resume after they connect. If the service, read tool, or `fisiolog:read` permission is unavailable, explain what blocked retrieval and ask the user to provide the record details if they still want a summary.
