# src/helpers/discord-lead.mjs

**Authority:** the source file. Development-only adapter for one subscription-authenticated Codex
lead shared between the native terminal and Discord. Start through Start-DiscordLead.ps1.
Inputs: private config/discord-lead.json, DPAPI bot token or launcher environment, saved session,
optional shared runtime. Outputs: channel progress, owner DMs, topic counts, private session/lock
and message history in logs/dev-discord-lead/. Imports root, the transport/routing helpers,
discord-terminal and discord-message.

Terminal commentary/final messages remain local. Only the real post_update MCP tool publishes
channel progress. send_dm sends direct replies verbatim; set_attention sets product-action/blocker
counts. On a changed prompt, initialization injects the current developer instructions into the
saved thread once (hash recorded in session.json), superseding obsolete instructions without a
model turn. Pending native
tool requests add to the topic action count. Topic failures are independent of delivery.
Native /clear switches the bridge and saved session to the new user thread on the dedicated host.
Owner messages steer the active turn or start one turn. Incoming DMs tell the agent to answer
with send_dm. No automatic receipt acknowledgments. !status reports the latest update
and pending count; !stop interrupts; !help explains conversational responses.

Both inputs poll every three seconds. Full pages drain before sleeping. Startup skips offline
messages, so resend offline instructions. The same RemoteDecisions queue serves shared and
headless operation. Native request resolution/turn completion removes stale prompts. Children
must belong to the saved lead session. Unsupported requests receive a decline/error and an owner
DM, rather than an inaccessible approval. Shared attachment does not own or kill the host.

--check/--dry-run checks configuration/login without messages or model turns. --test-dm and
--test-channel explicitly send neutral transport tests. --project-channel=TARGET previews a
route; --apply saves it. --shared-runtime is the terminal launcher's internal mode.

StatusBoard edits the existing pinned Actions/Blockers message every time the saved lists or
pending native request set changes. Its ID is saved in status-board.json; legacy channel-state
pins are reused on migration. The short topic links directly to that same message. Routine
refreshes poll every three seconds; rate limits never block owner DMs or tool decisions.
