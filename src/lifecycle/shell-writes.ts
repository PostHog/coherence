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
 * heredocs (whose bodies are text, never commands), `;`, `&&`, `||`, `|`
 * and newlines, and a `cd` earlier in the same line. It names the target of
 * an output redirect (`>`, `>>`, `>|`, `&>`, `N>`), the files of `tee`,
 * `sed -i` and `perl -i`, the destination of `cp`, `mv`, `install` and `ln`,
 * and the files of `touch`, `truncate` and `rm`. A word it cannot resolve
 * (a variable, a command substitution, a glob) is left out rather than
 * guessed, and so is a file a program writes from inside its own code
 * (`python3 -c "open(...)"`), which no reading of the command line can see.
 */

/** One word of a command, or an operator between words. */
type Token = { kind: "word"; text: string } | { kind: "op"; text: string };

/** Operators that end one simple command and start the next. */
const SEPARATORS: ReadonlySet<string> = new Set([";", "&&", "||", "|", "\n", "&", "(", ")"]);

/** Output redirections whose next word is a written file. */
const WRITE_REDIRECT = /^(?:\d*>>?|>\||&>>?)$/;

/** Heredoc bodies are text the command reads, never commands: drop them before reading the words. */
function withoutHeredocBodies(command: string): string {
  const lines = command.split("\n");
  const out: string[] = [];
  const pending: { tag: string; strip: boolean }[] = [];
  for (const line of lines) {
    if (pending.length > 0) {
      const { tag, strip } = pending[0]!;
      if ((strip ? line.replace(/^\t+/, "") : line) === tag) pending.shift();
      continue;
    }
    out.push(line);
    for (const match of line.matchAll(/<<(-?)\s*(['"]?)([A-Za-z_][\w-]*)\2/g)) pending.push({ tag: match[3]!, strip: match[1] === "-" });
  }
  return out.join("\n");
}

/** Split a command into words and operators, following single and double quotes and backslashes. */
function tokenize(command: string): Token[] {
  const tokens: Token[] = [];
  let word = "";
  let inWord = false;
  const flush = (): void => {
    if (inWord) tokens.push({ kind: "word", text: word });
    word = "";
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
    const op = /^(?:\d*>>|\d*>\||&>>|&>|\d*>&\d*-?|\d*>|<<-?|<<<|<&\d*|<|&&|\|\||\||;|&|\n|\(|\))/.exec(rest);
    // A digit only leads a redirection when it stands alone: "a2>b" is a word, "2>b" redirects.
    if (op !== null && !(/^\d/.test(op[0]) && inWord)) {
      flush();
      tokens.push({ kind: "op", text: op[0] });
      i += op[0].length - 1;
      continue;
    }
    word += ch;
    inWord = true;
  }
  flush();
  return tokens;
}

/** A word that names a file this reading can resolve: no variable, substitution, glob, or device. */
function resolvable(word: string): boolean {
  if (word === "" || word === "-") return false;
  if (/[$`*?[\]{}]/.test(word)) return false;
  if (word.startsWith("/dev/")) return false;
  return true;
}

function nonFlags(words: readonly string[]): string[] {
  const out: string[] = [];
  let ended = false;
  for (const word of words) {
    if (!ended && word === "--") {
      ended = true;
      continue;
    }
    if (!ended && word.startsWith("-") && word !== "-") continue;
    out.push(word);
  }
  return out;
}

/** The files one simple command writes, by what the command is. */
function commandWrites(words: readonly string[]): string[] {
  // Leading VAR=value assignments and wrappers that run the command after them.
  let start = 0;
  while (start < words.length && (/^[A-Za-z_]\w*=/.test(words[start]!) || ["sudo", "command", "nohup", "time", "env"].includes(words[start]!))) start += 1;
  const name = words[start]?.split("/").at(-1);
  const args = words.slice(start + 1);
  switch (name) {
    case "tee":
    case "touch":
    case "rm":
      return nonFlags(args);
    case "truncate": {
      const out: string[] = [];
      for (let i = 0; i < args.length; i += 1) {
        if (args[i] === "-s" || args[i] === "--size" || args[i] === "-r" || args[i] === "--reference") {
          i += 1;
          continue;
        }
        if (!args[i]!.startsWith("-")) out.push(args[i]!);
      }
      return out;
    }
    case "cp":
    case "mv":
    case "install":
    case "ln": {
      const rest = nonFlags(args);
      return rest.length >= 2 ? [rest[rest.length - 1]!] : [];
    }
    case "sed":
    case "perl": {
      const inPlace = args.some((a) => /^-[A-Za-z]*i/.test(a) || a.startsWith("--in-place"));
      if (!inPlace) return [];
      const files: string[] = [];
      let scriptGiven = false;
      for (let i = 0; i < args.length; i += 1) {
        const a = args[i]!;
        if (a === "-e" || a === "--expression" || a === "-f" || a === "--file") {
          scriptGiven = true;
          i += 1;
          continue;
        }
        // BSD sed takes the backup suffix as the next word: -i '' or -i .bak.
        if (name === "sed" && a === "-i" && i + 1 < args.length && (args[i + 1] === "" || args[i + 1]!.startsWith("."))) {
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
        files.push(a);
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

/**
 * The paths a shell command writes, each as written or joined onto the folder
 * a `cd` in the same line moved to; relative paths are the caller's to
 * resolve against the folder the command runs in.
 */
export function shellWrittenPaths(command: string): string[] {
  const tokens = tokenize(withoutHeredocBodies(command));
  const written: string[] = [];
  let dir = "";
  let words: string[] = [];
  const close = (): void => {
    if (words[0] === "cd") {
      const target = words[1];
      // Only a cd this reading can follow moves it; cd with no folder, to a variable, or back (-) leaves it unknown, so stop reading.
      if (target !== undefined && resolvable(target) && target !== "~" && !target.startsWith("~")) dir = joined(dir, target);
      else dir = "\0";
    } else if (dir !== "\0") {
      for (const path of commandWrites(words)) if (resolvable(path)) written.push(joined(dir, path));
    }
    words = [];
  };
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]!;
    if (token.kind === "op") {
      if (WRITE_REDIRECT.test(token.text)) {
        const next = tokens[i + 1];
        if (next?.kind === "word") {
          if (dir !== "\0" && resolvable(next.text)) written.push(joined(dir, next.text));
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
      if (SEPARATORS.has(token.text)) close();
      continue;
    }
    words.push(token.text);
  }
  close();
  return [...new Set(written)];
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
