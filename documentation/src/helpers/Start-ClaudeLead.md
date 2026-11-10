# src/helpers/Start-ClaudeLead.ps1

**Authority:** `src/helpers/Start-ClaudeLead.ps1`. Windows development launcher for the Claude Code
lead of the browser-dashboard migration (the Codex launcher `Start-DiscordLead.ps1` is retired
for leading; its `-Configure`, `-ProjectChannel` and `-Check` switches are still how the owner ID,
project channel and DPAPI-encrypted bot token are saved).

Purpose: start `claude --agent lead-architect --permission-mode auto --effort high` from the
repository root with the career-ops Discord bot attached through the official Claude Code Discord
channel plugin (`--channels plugin:discord@claude-plugins-official`).

What it does before launching:

- Resolves the repository root through `src/lib/root.mjs`, reads `config/discord-lead.json`
  and requires a valid `owner_id` and `project_channel_id`.
- Puts Bun on `PATH` when needed (the plugin's MCP server runs on Bun) and checks that
  `.claude/settings.local.json` enables the plugin for this repository.
- Creates `logs/dev-discord-lead/claude-channel/` as the plugin's `DISCORD_STATE_DIR` so this
  bot's allowlist and inbox never mix with another project's bot. On first run it writes
  `access.json` with `dmPolicy: allowlist`, the owner allowlisted by ID (no pairing codes) and
  the project channel enabled with `requireMention: false` restricted to the owner.
- Decrypts the DPAPI token into `DISCORD_BOT_TOKEN` for the Claude process only and restores the
  previous environment afterwards. The token never appears in arguments, logs or prompts.

Switches: `-Check` prints readiness and exits without starting Claude; `-Resume` opens Claude's
session picker; `-NoDiscord` starts the same lead without the channel.

Inbound owner messages (DM or project channel) reach the lead through the plugin; outbound
progress, the pinned action/blocker board and owner DMs use the `career_discord` MCP server in
`.mcp.json` (see [discord-message](discord-message.md)). Workflow rules are in the local
migration folder `documentation/dashboard-migration/DISCORD.md`.
