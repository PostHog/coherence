/**
 * The files a shell command writes, read from its text before it runs.
 *
 * An agent writes files through the shell as often as through an edit tool:
 * a heredoc onto a spec, `sed -i`, `tee`, a redirect, `cp`. A hook that only
 * reads an edit tool's file path misses every one of them, so a practice
 * triggered by an edit never fires and the chokepoint check at the edit never
 * runs (the ai-chatbot adoption wrote its entry spec with `cat > ... <<EOF`).
 *
 * This is a reading of the command's words, not a shell: it follows quotes,
 * CRLF line ends, heredocs (whose bodies are text, never commands; a `<<`
 * inside quotes opens none, and a here-string `<<<` has no body), `;`, `&&`,
 * `||`, `|` and newlines, a `cd` or `pushd` earlier in the line (`popd` goes
 * back), and a subshell `( ... )`, whose `cd` stays inside it. It names the
 * target of an output redirect (`>`, `>>`, `>|`, `&>`, `N>`), the files of
 * `tee`, `sed -i` and `perl -i`, the destination of `cp`, `mv`, `install` and
 * `ln` (under `-t`/`--target-directory`, each source's name inside that
 * folder), the sources `mv` removes, and the files of `touch`, `truncate` and
 * `rm`. Quoting is kept per word: a glob character, `$` or backtick outside
 * quotes, or a `$` or backtick inside double quotes, makes the word
 * unresolvable, while a quoted `[id]` or `(chat)` is a plain path; an
 * unquoted `(` opens a subshell, as the shell reads it. A word it cannot
 * resolve (a variable, a command substitution, a glob) is left out rather
 * than guessed, and so is a file a program writes from inside its own code
 * (`python3 -c "open(...)"`), which no reading of the command line can see.
 */

/** One word of a command, and whether an unquoted glob, variable or substitution in it leaves its text unknown until the shell expands it. */
type Word = { text: string; opaque: boolean };

/** One word of a command, or an operator between words. */
type Token = ({ kind: "word" } & Word) | { kind: "op"; text: string };

/** Operators that end one simple command and start the next. */
const SEPARATORS: ReadonlySet<string> = new Set([";", "&&", "||", "|", "\n", "&", "(", ")"]);

/** Output redirections whose next word is a written file. */
const WRITE_REDIRECT = /^(?:\d*>>?|>\||&>>?)$/;

/** Characters the shell expands outside quotes: a word holding one unquoted names no file this reading can know. */
const EXPANDED = /[$`*?[\]{}]/;

/** The folder a `cd` this reading could not follow leaves: nothing after it is read. */
const UNKNOWN = "\0";

/**
 * Split a command into words and operators, following single and double
 * quotes and backslashes, and skipping each heredoc's body at the end of the
 * line that opened it.
 */
function tokenize(command: string): Token[] {
  const tokens: Token[] = [];
  let word = "";
  let opaque = false;
  let inWord = false;
  /** A `<<` or `<<-` whose tag is the next word. */
  let awaitingTag: { strip: boolean } | undefined;
  const heredocs: { tag: string; strip: boolean }[] = [];
  const flush = (): void => {
    if (inWord) {
      if (awaitingTag !== undefined) {
        heredocs.push({ tag: word, strip: awaitingTag.strip });
        awaitingTag = undefined;
      }
      tokens.push({ kind: "word", text: word, opaque });
    }
    word = "";
    opaque = false;
    inWord = false;
  };
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i]!;
    if (ch === "'") {
      const end = command.indexOf("'", i + 1);
      word += command.slice(i + 1, end === -1 ? command.length : end);
      inWord = true;
      i = end === -1 ? command.length : end;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      for (; j < command.length && command[j] !== '"'; j += 1) {
        if (command[j] === "\\" && j + 1 < command.length) j += 1;
        else if (command[j] === "$" || command[j] === "`") opaque = true;
        word += command[j];
      }
      inWord = true;
      i = j;
      continue;
    }
    if (ch === "\\" && i + 1 < command.length) {
      if (command[i + 1] !== "\n") word += command[i + 1];
      inWord = true;
      i += 1;
      continue;
    }
    if (ch === " " || ch === "\t") {
      flush();
      continue;
    }
    if (ch === "#" && !inWord) {
      const end = command.indexOf("\n", i);
      i = (end === -1 ? command.length : end) - 1;
      continue;
    }
    const rest = command.slice(i);
    // <<< before <<: a here-string's word is read as it stands and opens no body.
    const op = /^(?:\d*>>|\d*>\||&>>|&>|\d*>&\d*-?|\d*>|<<<|<<-?|<&\d*|<|&&|\|\||\||;|&|\n|\(|\))/.exec(rest);
    // A digit only leads a redirection when it stands alone: "a2>b" is a word, "2>b" redirects.
    if (op !== null && !(/^\d/.test(op[0]) && inWord)) {
      flush();
      tokens.push({ kind: "op", text: op[0] });
      i += op[0].length - 1;
      if (op[0] === "<<" || op[0] === "<<-") awaitingTag = { strip: op[0] === "<<-" };
      else if (op[0] === "\n") {
        awaitingTag = undefined;
        // Each heredoc opened on the line just ended takes the lines after it, up to its tag, as text.
        for (const { tag, strip } of heredocs.splice(0)) {
          while (i + 1 < command.length) {
            const lineEnd = command.indexOf("\n", i + 1);
            const line = command.slice(i + 1, lineEnd === -1 ? command.length : lineEnd);
            i = lineEnd === -1 ? command.length : lineEnd;
            if ((strip ? line.replace(/^\t+/, "") : line) === tag) break;
          }
        }
      }
      continue;
    }
    if (EXPANDED.test(ch)) opaque = true;
    word += ch;
    inWord = true;
  }
  flush();
  return tokens;
}

/** A word that names a file this reading can resolve: nothing the shell expands outside quotes, and no device. */
function resolvable(word: Word): boolean {
  if (word.opaque || word.text === "" || word.text === "-") return false;
  if (word.text.startsWith("/dev/")) return false;
  return true;
}

function nonFlags(words: readonly Word[]): Word[] {
  const out: Word[] = [];
  let ended = false;
  for (const word of words) {
    if (!ended && word.text === "--") {
      ended = true;
      continue;
    }
    if (!ended && word.text.startsWith("-") && word.text !== "-") continue;
    out.push(word);
  }
  return out;
}

/** Short options of cp, mv, install and ln that take the next word (or the rest of their cluster) as their value. */
const VALUED_SHORT: Record<string, string> = { cp: "St", mv: "St", ln: "St", install: "Stmog" };

/** Long options of the same commands that take the next word as their value when written without `=`. */
const VALUED_LONG: ReadonlySet<string> = new Set(["--target-directory", "--suffix", "--mode", "--owner", "--group"]);

/**
 * What cp, mv, install or ln write: the destination, or under -t each
 * source's name inside the target folder, and for mv the sources it removes.
 */
function copyWrites(name: string, args: readonly Word[]): Word[] {
  let target: Word | undefined;
  const operands: Word[] = [];
  let ended = false;
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]!;
    if (ended || !a.text.startsWith("-") || a.text === "-") {
      operands.push(a);
      continue;
    }
    if (a.text === "--") {
      ended = true;
      continue;
    }
    if (a.text.startsWith("--")) {
      const eq = a.text.indexOf("=");
      const option = eq === -1 ? a.text : a.text.slice(0, eq);
      let value: Word | undefined = { text: a.text.slice(eq + 1), opaque: a.opaque };
      if (eq === -1) {
        value = VALUED_LONG.has(option) ? args[i + 1] : undefined;
        if (VALUED_LONG.has(option)) i += 1;
      }
      if (option === "--target-directory") target = value;
      continue;
    }
    for (let k = 1; k < a.text.length; k += 1) {
      const flag = a.text[k]!;
      if (!(VALUED_SHORT[name] ?? "").includes(flag)) continue;
      const value = k + 1 < a.text.length ? { text: a.text.slice(k + 1), opaque: a.opaque } : args[(i += 1)];
      if (flag === "t") target = value;
      break;
    }
  }
  const removed = name === "mv" ? operands : [];
  if (target !== undefined) {
    const placed = operands.map((source) => ({ text: joined(target.text, source.text.replace(/\/+$/, "").split("/").at(-1) ?? ""), opaque: target.opaque || source.opaque }));
    return [...removed, ...placed];
  }
  if (operands.length < 2) return [];
  return name === "mv" ? operands : [operands[operands.length - 1]!];
}

/** The files one simple command writes, by what the command is. */
function commandWrites(words: readonly Word[]): Word[] {
  // Leading VAR=value assignments and wrappers that run the command after them.
  let start = 0;
  while (start < words.length && (/^[A-Za-z_]\w*=/.test(words[start]!.text) || ["sudo", "command", "nohup", "time", "env"].includes(words[start]!.text))) start += 1;
  const name = words[start]?.text.split("/").at(-1);
  const args = words.slice(start + 1);
  switch (name) {
    case "tee":
    case "touch":
    case "rm":
      return nonFlags(args);
    case "truncate": {
      const out: Word[] = [];
      for (let i = 0; i < args.length; i += 1) {
        const a = args[i]!.text;
        if (a === "-s" || a === "--size" || a === "-r" || a === "--reference") {
          i += 1;
          continue;
        }
        if (!a.startsWith("-")) out.push(args[i]!);
      }
      return out;
    }
    case "cp":
    case "mv":
    case "install":
    case "ln":
      return copyWrites(name, args);
    case "sed":
    case "perl": {
      const inPlace = args.some(({ text: a }) => /^-[A-Za-z]*i/.test(a) || a.startsWith("--in-place"));
      if (!inPlace) return [];
      const files: Word[] = [];
      let scriptGiven = false;
      for (let i = 0; i < args.length; i += 1) {
        const a = args[i]!.text;
        if (a === "-e" || a === "--expression" || a === "-f" || a === "--file") {
          scriptGiven = true;
          i += 1;
          continue;
        }
        // BSD sed takes the backup suffix as the next word: -i '' or -i .bak.
        if (name === "sed" && a === "-i" && i + 1 < args.length && (args[i + 1]!.text === "" || args[i + 1]!.text.startsWith("."))) {
          i += 1;
          continue;
        }
        if (a.startsWith("-")) {
          if (name === "perl" && /e$/.test(a)) {
            scriptGiven = true;
            i += 1;
          }
          continue;
        }
        files.push(args[i]!);
      }
      return scriptGiven ? files : files.slice(1);
    }
    default:
      return [];
  }
}

/** Join a path onto the folder a `cd` earlier in the line moved to; an absolute path stands alone. */
function joined(dir: string, path: string): string {
  if (path.startsWith("/") || dir === "") return path;
  return `${dir.replace(/\/+$/, "")}/${path}`;
}

/** The folder a `cd` or `pushd` to this word moves to from dir, or UNKNOWN when this reading cannot follow it. */
function movedTo(dir: string, target: Word | undefined): string {
  // cd with no folder, to a variable, home (~) or back (-) leaves the folder unknown.
  if (target === undefined || !resolvable(target) || target.text.startsWith("~")) return UNKNOWN;
  if (target.text.startsWith("/")) return target.text;
  return dir === UNKNOWN ? UNKNOWN : joined(dir, target.text);
}

/**
 * The paths a shell command writes, each as written or joined onto the folder
 * a `cd` in the same line moved to; relative paths are the caller's to
 * resolve against the folder the command runs in.
 */
export function shellWrittenPaths(command: string): string[] {
  const tokens = tokenize(command.replace(/\r\n/g, "\n"));
  const written: string[] = [];
  let dir = "";
  /** The folder each open subshell started in, restored at its `)`. */
  const subshells: string[] = [];
  /** The folders pushd left, restored by popd. */
  const pushed: string[] = [];
  let words: Word[] = [];
  const close = (): void => {
    const name = words[0]?.text;
    if (name === "cd") dir = movedTo(dir, words[1]);
    else if (name === "pushd") {
      pushed.push(dir);
      dir = movedTo(dir, nonFlags(words.slice(1))[0]);
    } else if (name === "popd") dir = words.length === 1 ? (pushed.pop() ?? UNKNOWN) : UNKNOWN;
    else if (dir !== UNKNOWN) {
      for (const path of commandWrites(words)) if (resolvable(path)) written.push(joined(dir, path.text));
    }
    words = [];
  };
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]!;
    if (token.kind === "op") {
      if (WRITE_REDIRECT.test(token.text)) {
        const next = tokens[i + 1];
        if (next?.kind === "word") {
          if (dir !== UNKNOWN && resolvable(next)) written.push(joined(dir, next.text));
          i += 1;
        }
        continue;
      }
      if (/^(?:<|<<-?|<<<|<&\d*)$/.test(token.text)) {
        // An input redirect's word is read, not written, and is no argument of the command.
        if (tokens[i + 1]?.kind === "word") i += 1;
        continue;
      }
      if (/>&/.test(token.text)) continue;
      if (SEPARATORS.has(token.text)) {
        close();
        if (token.text === "(") subshells.push(dir);
        else if (token.text === ")" && subshells.length > 0) dir = subshells.pop()!;
      }
      continue;
    }
    words.push({ text: token.text, opaque: token.opaque });
  }
  close();
  return [...new Set(written)];
}

/** One simple command of a line: its words as the shell passes them (a quoted argument stays one word), and the folder a `cd` earlier in the line left, "" for where the line began, undefined when this reading cannot follow it. */
export interface SimpleCommand {
  words: string[];
  dir: string | undefined;
}

/**
 * The simple commands of a line, in order, each with the folder it runs in:
 * the same reading of quotes, heredocs (whose bodies are text, never
 * commands), separators, `cd`, `pushd`/`popd` and subshells as the written
 * files take.
 */
export function simpleCommands(command: string): SimpleCommand[] {
  const tokens = tokenize(command.replace(/\r\n/g, "\n"));
  const out: SimpleCommand[] = [];
  let dir = "";
  const subshells: string[] = [];
  const pushed: string[] = [];
  let words: Word[] = [];
  const close = (): void => {
    const name = words[0]?.text;
    if (words.length > 0) out.push({ words: words.map((w) => w.text), dir: dir === UNKNOWN ? undefined : dir });
    if (name === "cd") dir = movedTo(dir, words[1]);
    else if (name === "pushd") {
      pushed.push(dir);
      dir = movedTo(dir, nonFlags(words.slice(1))[0]);
    } else if (name === "popd") dir = words.length === 1 ? (pushed.pop() ?? UNKNOWN) : UNKNOWN;
    words = [];
  };
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]!;
    if (token.kind === "op") {
      // A redirect's word is a file, not an argument.
      if (WRITE_REDIRECT.test(token.text) || /^(?:<|<<-?|<<<|<&\d*)$/.test(token.text)) {
        if (tokens[i + 1]?.kind === "word") i += 1;
        continue;
      }
      if (SEPARATORS.has(token.text)) {
        close();
        if (token.text === "(") subshells.push(dir);
        else if (token.text === ")" && subshells.length > 0) dir = subshells.pop()!;
      }
      continue;
    }
    words.push({ text: token.text, opaque: token.opaque });
  }
  close();
  return out;
}

/** The shell command a tool event runs, as one string: a Bash command, or the argv a Codex shell tool names. */
export function shellCommandOf(record: Record<string, unknown>): string | undefined {
  const raw = record["command"] ?? record["cmd"];
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) {
    const parts = raw.filter((p): p is string => typeof p === "string");
    // ["bash", "-lc", "<script>"]: the script is the command.
    const flag = parts.findIndex((p) => /^-\w*c$/.test(p));
    if (flag >= 0 && parts[flag + 1] !== undefined && /(?:^|\/)(?:ba|z|da)?sh$/.test(parts[0] ?? "")) return parts[flag + 1];
    return parts.join(" ");
  }
  return undefined;
}
