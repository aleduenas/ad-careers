# config/examples/portals.example.yml

**Authority:** [config/examples/portals.example.yml](../../../config/examples/portals.example.yml).

Current scanner configuration example.

## Run and callers

Copy to private config/portals.yml. Configure actual boards and deliberately enable entries; examples are disabled.

## Inputs

Shows supported title/location filters, explicit Ashby/Greenhouse providers, hiring.cafe role discovery and a manual-only entry. It is not a verified employer directory.

## Behavior and outputs

The copied config is read by scan.mjs and verify-portals.mjs. Run verification and scan --dry-run first. Unsupported sites use pasted full-JD intake; no retired slash-command or search-engine workflow is implied.
