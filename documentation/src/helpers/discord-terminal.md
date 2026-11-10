# src/helpers/discord-terminal.mjs

**Authority:** the source file. Launches an authenticated loopback Codex app-server and
attaches native terminal plus Discord to the same saved thread. Called by Start-DiscordLead.ps1
-Terminal; --reload requests adapter-only restart through the running launcher supervisor, and
--reload-mcp uses the saved protected runtime connection to request the app-server's supported MCP
configuration reload for its loaded threads.
Imports Node process/net/crypto/fs/path/url/timers, root and _discord-lead. Exports transport,
argument/runtime validation and automatic-review setup used by discord-lead/tests.

Runtime capability lives in an account-only ACL directory. Native CLI receives it through an
environment variable; host arguments carry its hash. Bot/API credentials are stripped from Codex.
The terminal launcher owns both host and adapter and kills both when native Codex exits.
A second launcher refuses an already-running host. Adapter reload retains the live host;
an unexpected adapter exit closes the native view. SharedCodexRpc.close alone never kills the host.
The MCP reload request is host-scoped (the protocol has no thread or server selector); app-server
queues it for loaded threads. The command closes only its temporary client connection and never
restarts the host, terminal or adapter. It does not prove each refreshed server initialized;
inspect tool visibility on a later turn when the lead schedules activation.

The host loads the development instructions as its default, including after native /clear.
Settings API applies auto_review to loaded threads and active turns; remote native resume does
not accept CLI permission flags. Remaining requests are answerable through normal owner DMs.
Explicit post_update sends progress to the channel; topic counts are optional and independent.
Direct conversation uses the real send_dm MCP tool. Terminal prose stays local. No application work resumes merely because an adapter connects.
