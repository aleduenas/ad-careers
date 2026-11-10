# src/helpers/_discord-lead.mjs

**Authority:** the source file. Shared development-only Codex/Discord transports and approval queue.
Inputs: native executable, RPC notifications/requests, configured owner DM transport. Outputs:
JSON-RPC responses and owner questions. Imported by discord-lead, discord-terminal, discord-message
and the helper tests. Imports Node process/readline/timer/path modules and the repository root resolver.
developmentConfig registers the local career_discord MCP server for native send_dm, post_update
and set_attention tools, without modifying global configuration.

Uses subscription login, workspace sandbox and automatic review. Codex children receive no bot
or API credentials. RemoteDecisions serializes remaining command/file/permission/MCP approvals
and user-input questions into normal owner DMs. Ordinary ok/no grants one request only;
permissions last one turn with strict automatic review. General MCP forms accept owner-entered
JSON (single-field forms also accept plain text). There are no browser, URL, argument-key or
keyword allowlists. Native resolution and turn completion invalidate matching requests.
Only replies newer than the delivered prompt can answer it. Secret questions require a secure
local prompt. Unsupported requests are declined by the launcher with an owner notification.
No reply codes, event markers, status snapshots or pinned-board management remain.
