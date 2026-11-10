# src/helpers/_discord-channel.mjs

**Authority:** the source file. Resolves project channel routes, validates owner messages and
checks channel delivery permissions/content intent. Imported by discord-lead and tests.

StatusBoard maintains one bot-owned pinned message with current Actions and Blockers lists.
It edits that message on changes, shows No action needed when clear, and saves its ID for reuse
on restart. The legacy board ID is adopted instead of creating a duplicate. Only bot-owned
messages may be edited. New messages are pinned; Pin Messages permission is needed for that.

TopicStatus maintains exactly `Actions: N | Blockers: N | Attention needed | <pinned-message URL>` with numeric counts. Omit Attention needed unless an owner action is pending or a blocker
requires the owner. No prefix, descriptive details or Attention pending suffix
is used. Details belong only in the pinned message. Unchanged status causes no writes. Discord
rate limits/errors back off without preventing DMs or approvals. Manage Channels enables topic
editing. No terminal prose, DM markers or reply parsing is used to populate the board.

Attention is required for pending owner actions/native requests or blocker details tagged
[Needs you] or [Fully blocked]. Ordinary agent-work blockers alone do not request attention.
