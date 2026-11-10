# src/helpers/test-discord-terminal.mjs

**Authority:** the source file. Offline native/shared runtime lifecycle tests, run directly or
by src/test-all.mjs. Imports Node assert/process/fs/path, root and terminal/transport helpers.
Verifies runtime authentication, remote attachment arguments, credential stripping, approval
settings, exact null-parameter MCP reload RPC, client replacement/disconnect isolation and Windows
runtime ACL setup. The ACL test
uses an isolated fixture in logs/tests and preserves directory owner/group/state. No model turns,
network requests, live Discord or personal database access.
