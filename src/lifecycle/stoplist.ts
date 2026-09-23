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

/**
 * The general programming words a declared name, a heading, or a backticked
 * word is built from: operations, containers, plumbing, and markup. They are
 * the language's and the library's senses, never a project's. A word a
 * project could give its own sense (scope, core, session, store, owner,
 * slice, record, model, flow, view) is never here: that is where
 * ambiguity lives, and it stays a candidate.
 */
const PROGRAMMING = `
root roots sync async await map maps filter filters reduce render renders rendered parse parses parsed
parser equal equals deep length join joined split find found cwd dir dirs env args argv arg param
params opts ctx callback callbacks handler handlers util utils helper helpers init main tmp temp src lib
bin assert expect mock mocks stub stubs fixture fixtures try catch throw throws hex gap str len obj arr
buf buffer buffers stream streams promise promises reject emit event events log logs logger debug info
warn exec spawn process processes stdout stderr stdin pid fetch get put post del insert upsert select
match matches replace trim push pop shift sort sorted count counts size width height min max sum avg
idx iter prev head tail body header headers footer flag flags opt prop props attr attrs style styles
color colors font fonts border margin padding button buttons click hover label labels title titles div
span icon icons image images img href regex regexp pattern patterns template templates wrapper wrappers
instance instances factory factories builder builders setter getter getters setters loop loops index
indexes indices hash hashes cache caches queue queues stack stacks tree trees edge edges
array char chars int ints float bool enum enums struct structs interface interfaces tuple tuples
const var let def fn func lambda closure closures this self super null nil none undefined
state states status statuses mode modes kind flag timestamp timestamps date dates timeout timeouts retry
retries limit limits offset offsets source sources target targets command commands symbol symbols range ranges
position positions location locations pointer pointers slot slots sample samples sentence sentences form forms
shape shapes fact facts site sites context contexts
usage introduction background setup guide tutorial faq appendix contents readme license
changelog contributing roadmap plan plans question questions answer answers problem problems solution
solutions issue issues bug bugs fix fixes support help tip tips
`;

/**
 * Words that describe a state or an action rather than name a thing: the
 * adjectives and verbs code declares as fields and flags (missing, latest,
 * visible) and prose uses on every page. A concept is a noun.
 */
const STATES = `
current active inactive latest fresh stale visible hidden present absent missing unknown valid invalid
enabled disabled pending ready complete incomplete required optional top bottom left right inner outer
outside inside broke broken fail fails pass passes carries carry reach reaches written require requires
exists exist allow allows allowed deny denies ok true false yes maybe verbose quiet silent strict loose
raw full partial total whole single multiple many few same other own primary secondary applicable dirty clean
`;

export const STOPLIST: ReadonlySet<string> = new Set(`${WORDS}\n${PROGRAMMING}\n${STATES}`.split(/\s+/).filter((w) => w !== ""));

/** Words English capitalizes in any sentence: a capital letter on them never marks a project's proper noun. */
export const ALWAYS_CAPITALIZED: ReadonlySet<string> = new Set(
  `monday tuesday wednesday thursday friday saturday sunday january february march april may june july
august september october november december english latin`.split(/\s+/).filter((w) => w !== ""),
);
