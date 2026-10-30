# Relief

The reading Scope's Structure view draws beyond the spec: each component's files with their lines and reach, the folders with no spec inside a component that holds others as districts, the landings on HEAD's first-parent line, the commits and diffs a reader can compare, and the agent activity the read traces record.

## invariants
- a diff names only commits: The relief's diff takes as either end only a name of 4 to 40 or 64 hex digits (an abbreviated or full SHA-1 or SHA-256 id), or the working tree as the later end, and refuses any other name before any git runs; a name it takes is looked up among objects alone, never among refs, and git's diff is given the full id of the one commit whose id it begins, so a branch or tag named in hex digits, a name beginning no commit's id, and one beginning several are refused.
  over: every pair of names a reader can send the live page's diff, as either end, a hex name that is also a branch's among them
  via: a diff names only commits: an option, a range, a ref or a path is refused, and a name of hex digits is read as a commit id, never as a branch
  because: the diff answers a browser page on the warm server's port, and git reads an argument that starts with a dash as an option (--output writes a file wherever it names); naming commits by their ids alone leaves nothing for a caller to smuggle in, and the page only ever offers commits git itself listed; git reads a short hex name as a branch before a commit, so a branch named cafe would otherwise stand in for the commit the page offered
  crossing: local-caller -> instrument
  refuted: widened REVISION to any name without a dot, so an option or a ref passed -> "a diff names only commits: an option, a range or a path is refused before git sees it" went red in relief.test.ts; restored (cmp), green (2026-10-30)
  kinds: none
- districts are a container's own folders: Inside a component that holds other components, the code none of them claims stands as one district per folder that holds three or more of its files, a folder holding most of that code is opened into its own folders, and files loose in an opened folder stay with the component.
  over: a container's own files, across a dominant folder, ordinary folders, a folder below the threshold and loose files
  via: a container's own files stand as districts by the folder holding them: three files or more, a folder holding most of them opened into its own
  because: on PostHog the products folder held 3.76 million lines no spec claimed as one block, which said nothing about where the unclaimed land lies; splitting by folder at the threshold mass already names a unit by shows its shape, and a folder holding nearly everything (frontend/src) would only be the block again
  refuted: stopped districtsOf opening a folder that holds most of the lines, so src stood as one district -> "a container's own files stand as districts by the folder holding them: three files or more, a folder holding most of them opened into its own" went red in relief.test.ts; restored (cmp), green (2026-10-30)
  kinds: none
- a trace line lights once: Each read or write line appended to a read trace while the live server follows it is one touch, sent once: the traces as they stood when it began following them, and what they gained while no page was connected, are history and never sent; a trace that appears later is all new; a line still being written waits for the next look, a damaged line lights nothing, and a snapshot is no touch.
  over: text appended to a trace: whole read and write lines, a damaged line, a snapshot, an unfinished line split inside a multi-byte character, and a path of multi-byte characters; and the offsets the server keeps over a traces folder: a trace standing at the start, a trace that appears after it, lines appended while no page was connected, a look the watcher named no trace for, and a trace not named
  via: a trace's appended lines are touches once: what stood before the server followed or while no page was there is history, a line still being written waits, a damaged line lights nothing, and a snapshot is no touch
  because: the Structure view lights what agents read and write as it happens, from the traces the hooks already append; an offset that ran past a half-written line would drop the touch it became, and one counted in characters rather than bytes would skip or repeat lines after any non-ASCII path; a page that connects is shown what happens from then on, so a backlog the server never read must not flood it, and reading only the traces the watcher named keeps a busy agent's beat off the hooks' event loop
  crossing: record -> reading
  refuted: counted the consumed text in characters instead of bytes -> "a trace's appended lines are touches once: a line still being written waits, a damaged line lights nothing, and a snapshot is no touch" went red in relief.test.ts on the multi-byte path; restored (cmp), green (2026-10-30)
  kinds: none
