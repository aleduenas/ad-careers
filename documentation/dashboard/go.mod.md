# Go module manifest

**Authority:** [dashboard/go.mod](../../dashboard/go.mod).

Declares module `career-ops/dashboard`, minimum Go 1.25.0 and module dependencies including Bubble Tea, Lip Gloss, termenv and pgx. Read by Go build/test and both CI workflows for toolchain selection. `go.sum` records dependency checksums. Maintain both through Go module commands; neither is an operational data store.

