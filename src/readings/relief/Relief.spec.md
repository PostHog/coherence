# Relief

The reading Scope's Structure view draws beyond the spec: each component's files with their lines and reach, the folders with no spec inside a component that holds others as districts, the landings on HEAD's first-parent line, the commits and diffs a reader can compare, and the agent activity the read traces record.

## invariants
- a diff names only commits: The relief's diff passes git only names that are abbreviated or full commit ids, or the working tree as the later end; an option, a range, a ref or a path is refused before any git runs.
  over: every pair of names a reader can send the live page's diff, as either end
  via: a diff names only commits: an option, a range or a path is refused before git sees it
  because: the diff answers a browser page on the warm server's port, and git reads an argument that starts with a dash as an option (--output writes a file wherever it names); naming commits by their ids alone leaves nothing for a caller to smuggle in, and the page only ever offers commits git itself listed
  crossing: local-caller -> instrument
  refuted: widened REVISION to any name without a dot, so an option or a ref passed -> "a diff names only commits: an option, a range or a path is refused before git sees it" went red in relief.test.ts; restored (cmp), green (2026-10-30)
  kinds: none
- districts are a container's own folders: Inside a component that holds other components, the code none of them claims stands as one district per folder that holds three or more of its files, a folder holding most of that code is opened into its own folders, and files loose in an opened folder stay with the component.
  over: a container's own files, across a dominant folder, ordinary folders, a folder below the threshold and loose files
  via: a container's own files stand as districts by the folder holding them: three files or more, a folder holding most of them opened into its own
  because: on PostHog the products folder held 3.76 million lines no spec claimed as one block, which said nothing about where the unclaimed land lies; splitting by folder at the threshold mass already names a unit by shows its shape, and a folder holding nearly everything (frontend/src) would only be the block again
  refuted: stopped districtsOf opening a folder that holds most of the lines, so src stood as one district -> "a container's own files stand as districts by the folder holding them: three files or more, a folder holding most of them opened into its own" went red in relief.test.ts; restored (cmp), green (2026-10-30)
  kinds: none
- a trace line lights once: Each read or write line appended to a read trace is one touch, sent once: a line still being written waits for the next look, a damaged line lights nothing, and a snapshot is no touch.
  over: text appended to a trace: whole read and write lines, a damaged line, a snapshot, an unfinished line, and a path of multi-byte characters
  via: a trace's appended lines are touches once: a line still being written waits, a damaged line lights nothing, and a snapshot is no touch
  because: the Structure view lights what agents read and write as it happens, from the traces the hooks already append; an offset that ran past a half-written line would drop the touch it became, and one counted in characters rather than bytes would skip or repeat lines after any non-ASCII path
  crossing: record -> reading
  refuted: counted the consumed text in characters instead of bytes -> "a trace's appended lines are touches once: a line still being written waits, a damaged line lights nothing, and a snapshot is no touch" went red in relief.test.ts on the multi-byte path; restored (cmp), green (2026-10-30)
  kinds: none
