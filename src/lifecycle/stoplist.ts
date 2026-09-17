/**
 * Common words the unknown-noun check never nominates. Small and built in:
 * function words, the verbs and nouns of ordinary technical prose, and the
 * tokens of the tooling every project shares. A domain noun is never here.
 */
const WORDS = `
a about above after again against all almost also although always am among an and another any
anyone anything are around as at away back be became because become becomes been before begin
behind being below between beyond both but by came can cannot case cases certain change changed
changes come comes could day days did different do does doing done down during each early either
else end enough even ever every everything example examples except far few first five for four
from further get gets given gives go goes going good got great had has have having he her here
hers high him his how however i if in inside instead into is it its itself just keep kept kind
know known large last later least less let like little long look made make makes making many may
me might more most much must my near need needs never new next no none nor not nothing now of off
often old on once one only onto or other others otherwise our out over own part parts per perhaps
place point put rather really right said same saw say says second see seen set several shall she
should show shown since six small so some someone something sometimes soon still such take taken
than that the their them themselves then there these they thing things think third this those
though three through thus time times to today together too took toward two under until up upon
us use used uses using very was way ways we well went were what whatever when where whether
which while who whole whom whose why will with within without would yes yet you your yours zero
note notes todo fixme warning caveat step steps phase phases part section sections chapter
version versions status summary detail details description purpose goal goals option
options result results reason reasons rule rules list lists item items entry entries value
values type types kind kinds name names key keys id ids line lines file files folder folders
directory directories path paths code data field fields table tables row rows column columns
string strings number numbers boolean object objects array arrays function functions method
methods class classes module modules package packages import export exports default internal external
true false null undefined void none empty error errors exception exceptions failure failures
success test tests testing check checks input inputs output outputs request requests response
responses call calls return returns start started stop stopped end ended read reads write writes
create created delete deleted update updated add added remove removed open close closed load
loads save saved run runs runtime build builds config configuration setting settings install
installed installation project projects repo repository branch branches commit commits merge
user users human humans agent agents machine machines system systems service services server
servers client clients api apis url urls uri http https json html css markdown text texts
typescript javascript node npm npx git github cli sql byte bytes token tokens kb mb gb ms
second seconds minute minutes hour hours week weeks month months year years monday tuesday
wednesday thursday friday saturday sunday january february march april may june july august
september october november december english latin
`;

export const STOPLIST: ReadonlySet<string> = new Set(WORDS.split(/\s+/).filter((w) => w !== ""));
