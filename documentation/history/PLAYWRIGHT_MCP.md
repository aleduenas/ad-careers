# Playwright MCP development integration

**Authority:** the local project .mcp.json configuration and the connected server's tool schemas.
This historical note was reconciled with the current repository on 2026-09-20.

The project retains its development MCP configuration. It launches Microsoft's external
Playwright MCP server through npx.cmd with headless, isolated browser arguments. The server
version uses @latest, so clients must inspect the connected tool schemas rather than copy
old parameter names from archived sessions. This completion pass did not test MCP connectivity.

This development integration is separate from the Playwright npm library used by
[src/cvgen/generate-pdf.mjs](../../src/cvgen/generate-pdf.mjs) and scan providers. Those scripts
launch their own browser sessions. Installing npm dependencies does not register an MCP
server in another client. Generated .playwright-mcp captures are ignored private runtime
state; older captures were archived under data/archive/browser-captures-2026/.

Retired conversational modes are archived under data/archive/modes-retired-2026/ and are
not entry points. Normal discovery runs through [the scanner](../src/scan/scan.md), including
hiring.cafe's public-search, canonical-JD and blocking contract. Evaluation and drafting read
cached JDs from data/jds and PostgreSQL. Development browser availability does not change
that policy or authorize application submission. See [AGENTS.md](../../AGENTS.md).
