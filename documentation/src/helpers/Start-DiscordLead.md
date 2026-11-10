# src/helpers/Start-DiscordLead.ps1

> **Retired note (2026-11-09, D033):** The -Terminal Codex launcher is retired (D033). Keep using -Configure, -ProjectChannel ... -Apply, -Check, -TestDm and -TestChannel to configure and test the bot; launch the lead with Start-ClaudeLead.ps1.

`-Terminal` protects a generated runtime directory with an owner-only Windows ACL and invokes
`discord-terminal.mjs` to attach native Codex and Discord to one dedicated persistent runtime.
The launcher writes only the DACL through `Directory.SetAccessControl`. It does not change the
directory owner/group or audit rules and does not use `Set-Acl`/request SeSecurityPrivilege.
The same setup supports new and existing directories under a normal Windows account.
`-ReloadDiscord` requests an adapter-only reload from an existing terminal supervisor without
reading/decrypting the bot token. See local migration [TERMINAL.md](../../dashboard-migration/TERMINAL.md)
for activation, approval ownership and verification limits. Existing switches remain available.

**Authority:** `src/helpers/Start-DiscordLead.ps1`. Windows development launcher.
Purpose: configure the owner and DPAPI-encrypted bot token, check readiness, test a DM or launch
the Codex bridge. Inputs: hidden local token prompt, Discord user ID, native Codex/Node executables.
Outputs: ignored config/encrypted token; child-process environment temporarily carries the token.
Dependencies: Windows PowerShell DPAPI, Node root resolver and `discord-lead.mjs`. No callers;
run manually with `-Configure`, `-Login`, `-Check`, `-TestDm`, `-TestChannel`, or no switches to launch.
`-ProjectChannel SERVER/CHANNEL` (or link/ID) previews the route and required permissions;
repeat with `-Apply` to save. These operations send no messages and start no model turn.
Native executable discovery uses optional `-CodexPath`, a valid saved executable, PATH, then
installed VS Code/Insiders/Cursor Codex extensions. A bare `codex` PATH entry is not required.
The selected path is passed to Node through a temporary `CAREER_DISCORD_CODEX_COMMAND` variable.
Local migration instructions: [DISCORD.md](../../dashboard-migration/DISCORD.md).
