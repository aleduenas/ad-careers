# src/helpers/discord-message.mjs

**Authority:** the source file. Owner-only Discord MCP tools for the development lead, plus a
diagnostic CLI. Registered for Claude Code as the `career_discord` server in `.mcp.json`
(`node src/helpers/discord-message.mjs --mcp`); the retired Codex bridge registered the same
server through its launcher.

Tools:
- send_dm({text}) sends exactly that text to the configured owner DM. Use for decisions the
  owner must make, blockers only the owner can clear, milestones and replies to owner DMs.
- post_update({text}) posts one work-progress event to the configured project channel (silent
  notification flag, so the owner reads the channel on their own schedule).
- set_attention({actions: [descriptions], blockers: [descriptions]}) replaces the current lists,
  saves them to private `logs/dev-discord-lead/attention.json`, then edits the one standing
  pinned message in the project channel and sets the topic to
  `Actions: N | Blockers: N [| Attention needed] | <link to the pinned message>`. Use empty
  arrays when clear. Legacy integer counts remain accepted. Lists must fit within 1700
  serialized characters. The pinned message ID is reused across restarts through
  `logs/dev-discord-lead/status-board.json`.

`refreshStatusBoard(discord, config, state)` is the exported board writer (wrapping
`StatusBoard` from `_discord-channel.mjs`); `callDiscordTool` receives it as the injectable
`updateBoard` option, so no separate bridge process is needed to keep the pin and topic current.

No recipient IDs may be provided. The helper validates the configured owner DM and returns
Discord message IDs only after delivery succeeds. send_dm('hello world') sends only hello world,
without headings or status blocks. Terminal prose and tool receipts are never channel updates.

The newline-delimited stdio MCP server supports initialize, ping, tools/list and tools/call.
Discovery needs no credential access. Actual calls load private configuration and the DPAPI
credential internally. Tokens never appear in prompts, command arguments, stdout or agent
environments. No MCP SDK or extra service dependency is needed.

The CLI remains for diagnostics: --dm TEXT previews; repeat with --send to deliver. Optional
--actions=N/--blockers=N updates attention.json and refreshes the board, not job data.

Imports Node fs/readline/process/path/url, root, _discord-lead and _discord-channel. The retired
bridge also imports readAttention/loadDiscordToken/sendOwnerDm. Tests (`test-discord-lead.mjs`)
inject the Discord client, the attention writer and the board updater.
