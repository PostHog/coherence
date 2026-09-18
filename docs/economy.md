# Economy, calibrate, and mass

Three readings over the model, computed when asked and never stored.

```sh
node src/cli.ts economy <path>... [--json] [--limit <n>]
node src/cli.ts calibrate [--json]
node src/cli.ts mass [--json]
```

## Economy

Economy predicts what a reader must load to modify the given files safely.
The closure is computed from references through the adapter's resolve and
references:

- the given files;
- one hop out: the files defining what the given files reference. An imported
  name is resolved and kept only when a reference site in a given file uses
  it outside an import specifier;
- one hop in: the files referencing what the given files define. Each
  top-level declaration is resolved as `name in file`; every reference site
  outside the given files joins, a test reference marked as such;
- the spec of every component a closure file lies in;
- every invariant whose protected thing or chokepoint lives in a given file:
  its spec and the file on the other side.

Each entry says why it is there. The token estimate is bytes divided by
four. With no instrument the hops are skipped, invariants come from the
files the latest run touched, and the closure says so. The same tree yields
the same closure: entries sort by path, why lines within an entry. No
address lives in a glossary or a spec. The command drives the adapter in
process; the warm server is reached only through the run today.

## Read traces

A read trace is the files a session explicitly read: one line per
PostToolUse of a reading tool naming a file under the root, appended to
`.coherence/traces/<session>.jsonl`. At Stop a snapshot line records the
patch (the working tree against HEAD, plus untracked), the files read, and
the closure predicted for the patch. Traces are not committed: per session and larger than the journal, while the labels
calibrate needs come from the journal and the runs, which are.

## Calibrate

For every trace with a snapshot, calibrate reports the predicted closure of
the files the session changed, the files it read, their overlap, what was
read outside the prediction, and what was predicted but never read. Coverage
is the share of what was read that the prediction named. The outcome label
is automatic, and only automatic:

- `defect`: a journal defect record written after the snapshot names a file
  in the patch, or a later run found a structural defect whose files or
  bypasses touch the patch;
- `clean`: otherwise, a later run checked an enforcement whose files touch
  the patch and every such entry passed;
- `unknown`: neither has happened yet.

A defect always wins. A totality oracle entry carries no files, so today only
chokepoint checks label clean. The aggregate says how often the prediction
covered everything read, by outcome. No command sets a label.

## Mass

Two numbers side by side for each component and the project: total mass
(lines, files, symbols) and unreached mass: code in no component (no spec
file above it) and code in a component that no invariant's chokepoint or
protected thing reaches. Reach is at file level, from the latest run's
chokepoint entry files, else from the files declaring the spec's named
symbols. Symbols are top-level declarations by a plain scan. Test files are
the detectors, not the load: counted aside.

Unreached prints first. A large object with no definition is a wobbly load,
and the way down is an invariant, not a deletion: never a threshold, never a
baseline, never a failure on growth.
