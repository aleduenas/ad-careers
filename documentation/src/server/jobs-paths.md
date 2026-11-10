# src/server/jobs-paths.mjs

**Authority:** the source file and `documentation/dashboard-migration/design/STAGE2_READ_CONTRACT.md`
(artifact and report access rules).

Path-containment helpers for every file the browser API reads on a job's behalf. Exports
`inspectSafeFile(rootDir, relativePath, allowedRoots)`, which resolves a relative path under one of
the allowed repository subfolders, walks each component with `lstat` and refuses symbolic links,
junctions, absolute paths and `..` escapes. It returns `{status:'ok',path,allowedRoot}`,
`{status:'missing'}` or `{status:'unsafe'}`; `resolveSafeFile` keeps only the `ok` case.
`resolveSafeDirectory(rootDir, candidate, allowedRoot)` performs the same containment check for a
directory, and `isContainedPath(parent, child)` is the pure lexical predicate.

Nothing here reads file contents. Callers (`jobs-compensation.mjs`, `jobs-materials.mjs`) pass the
repository root and the allowed roots `data/evaluations` and `output`, so a stored `report_path`
or an output folder can never point the server at another location.

**Tests:** `node --test src/server/test-jobs-read.mjs` exercises allowed, missing, escaped and
symlinked paths against a temporary directory.
