# src/helpers/test-discord-lead.mjs

**Authority:** the source file. Offline regressions for the development bridge. Run with node;
discovered by src/test-all.mjs. Imports Node assert and the bridge/transport/routing/message helpers.
No model turns, live Discord, personal database or credential reads.

Checks serial conversational approvals, one-use/turn scope, native resolution, stale replies,
MCP tools without browser allowlists, structured questions/forms, active-turn steering, child
trust, unsupported-request notification, no terminal forwarding, explicit MCP channel updates, exact owner-only DM text with receipts,
MCP initialization/discovery without credentials,
dry-run parsing and topic failure isolation. Transport tests verify disabled mentions and
credential stripping. Live incoming-owner and browser acceptance require separate evidence.

Pinned-status regressions verify reuse, edits on resolution, no repeated API writes, ID
persistence/restart, bot ownership, description lists, and the exact short topic/link format.
