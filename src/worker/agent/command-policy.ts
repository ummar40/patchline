import { posix } from "node:path";
import { REPOSITORY_DIR } from "../sandbox/types";

// The sandbox is the security boundary. This policy is a second guard in front of it: it
// keeps model-requested commands inside the maintenance task (no network tools, no VCS or
// registry mutations, no dependency changes, no tampering with .git, no writes outside the
// workspace) and refuses shell syntax that would hide what is actually being run.

export type CommandVerdict = { allowed: true } | { allowed: false; reason: string };

const MAX_COMMAND_LENGTH = 2_000;

type Token = { kind: "word"; value: string } | { kind: "operator"; value: string };

const SEPARATORS = new Set(["&&", "||", ";", "|"]);

const ALLOWED_PROGRAMS = new Set([
  "ls",
  "cat",
  "head",
  "tail",
  "wc",
  "grep",
  "egrep",
  "fgrep",
  "rg",
  "find",
  "sort",
  "uniq",
  "cut",
  "tr",
  "sed",
  "awk",
  "diff",
  "cmp",
  "file",
  "stat",
  "du",
  "basename",
  "dirname",
  "realpath",
  "readlink",
  "which",
  "echo",
  "printf",
  "test",
  "[",
  "true",
  "false",
  "pwd",
  "cd",
  "date",
  "sleep",
  "seq",
  "mkdir",
  "touch",
  "cp",
  "mv",
  "rm",
  "tee",
  "chmod",
  "patch",
  "node",
  "npm",
  "npx",
  "pnpm",
  "yarn",
  "tsc",
  "tsx",
  "ts-node",
  "jest",
  "vitest",
  "mocha",
  "ava",
  "tap",
  "c8",
  "nyc",
  "eslint",
  "prettier",
  "biome",
  "next",
  "vite",
  "webpack",
  "rollup",
  "turbo",
  "nx",
  "python",
  "python3",
  "pytest",
  "tox",
  "nox",
  "ruff",
  "flake8",
  "mypy",
  "pylint",
  "black",
  "isort",
  "poetry",
  "pip",
  "pip3",
  "coverage",
  "make",
  "git",
  "bash",
  "sh",
]);

const WRAPPERS = new Set(["env", "time", "timeout", "nice", "xargs"]);

const DENIED_PROGRAMS: Record<string, string> = {
  curl: "network access is not available",
  wget: "network access is not available",
  nc: "network access is not available",
  ncat: "network access is not available",
  netcat: "network access is not available",
  telnet: "network access is not available",
  ftp: "network access is not available",
  ssh: "network access is not available",
  scp: "network access is not available",
  sftp: "network access is not available",
  rsync: "network access is not available",
  sudo: "privilege escalation is not permitted",
  su: "privilege escalation is not permitted",
  doas: "privilege escalation is not permitted",
  chown: "changing ownership is not permitted",
  mount: "system administration commands are not permitted",
  umount: "system administration commands are not permitted",
  docker: "container tooling is not available",
  podman: "container tooling is not available",
  kubectl: "container tooling is not available",
  apt: "system packages cannot be changed",
  "apt-get": "system packages cannot be changed",
  dpkg: "system packages cannot be changed",
  apk: "system packages cannot be changed",
  yum: "system packages cannot be changed",
  brew: "system packages cannot be changed",
  eval: "indirect command execution is not permitted",
  exec: "indirect command execution is not permitted",
  source: "indirect command execution is not permitted",
  ".": "indirect command execution is not permitted",
  nohup: "background processes are not permitted",
  disown: "background processes are not permitted",
  kill: "process control is not permitted",
  pkill: "process control is not permitted",
  killall: "process control is not permitted",
  shutdown: "system administration commands are not permitted",
  reboot: "system administration commands are not permitted",
  dd: "raw device access is not permitted",
  mkfs: "raw device access is not permitted",
};

const GIT_ALLOWED_SUBCOMMANDS = new Set([
  "status",
  "diff",
  "log",
  "show",
  "blame",
  "grep",
  "ls-files",
  "ls-tree",
  "rev-parse",
  "cat-file",
  "restore",
  "checkout",
  "apply",
]);

const PACKAGE_MANAGER_DENIED = new Set([
  "install",
  "i",
  "ci",
  "add",
  "remove",
  "rm",
  "uninstall",
  "un",
  "update",
  "up",
  "upgrade",
  "link",
  "unlink",
  "publish",
  "login",
  "logout",
  "adduser",
  "token",
  "owner",
  "access",
  "config",
  "set",
  "dedupe",
  "audit",
  "dlx",
  "create",
  "init",
  "import",
  "cache",
  "store",
]);

const PIP_ALLOWED = new Set(["list", "show", "freeze", "check", "--version", "-V"]);
const POETRY_ALLOWED = new Set(["run", "check", "show", "version", "env", "--version"]);
const FIND_DENIED = new Set([
  "-exec",
  "-execdir",
  "-ok",
  "-okdir",
  "-delete",
  "-fprint",
  "-fprintf",
  "-fls",
]);
const MUTATING_PROGRAMS = new Set([
  "mkdir",
  "touch",
  "cp",
  "mv",
  "rm",
  "tee",
  "chmod",
  "patch",
  "sed",
]);
const WRITABLE_ROOTS = [`${REPOSITORY_DIR}/`, "/tmp/"];

const GIT_INTERNALS = /(^|\/)\.git(\/|$)/;

function deny(reason: string): CommandVerdict {
  return { allowed: false, reason };
}

function tokenize(command: string): Token[] | string {
  const tokens: Token[] = [];
  let index = 0;
  let word: string | undefined;

  const pushWord = () => {
    if (word !== undefined) {
      tokens.push({ kind: "word", value: word });
      word = undefined;
    }
  };

  while (index < command.length) {
    const char = command[index] as string;
    const next = command[index + 1];

    if (char === "'") {
      const end = command.indexOf("'", index + 1);
      if (end === -1) {
        return "unterminated single quote";
      }
      word = (word ?? "") + command.slice(index + 1, end);
      index = end + 1;
      continue;
    }

    if (char === '"') {
      let value = "";
      index += 1;
      for (;;) {
        const inner = command[index];
        if (inner === undefined) {
          return "unterminated double quote";
        }
        if (inner === '"') {
          break;
        }
        if (inner === "`" || (inner === "$" && command[index + 1] === "(")) {
          return "command substitution is not permitted";
        }
        if (inner === "\\" && command[index + 1] !== undefined) {
          value += command[index + 1];
          index += 2;
          continue;
        }
        value += inner;
        index += 1;
      }
      word = (word ?? "") + value;
      index += 1;
      continue;
    }

    if (char === "\\") {
      if (next === undefined) {
        return "trailing backslash";
      }
      word = (word ?? "") + next;
      index += 2;
      continue;
    }

    if (char === "`" || (char === "$" && next === "(")) {
      return "command substitution is not permitted";
    }
    if ((char === "<" || char === ">") && next === "(") {
      return "process substitution is not permitted";
    }
    if (char === "<" && next === "<") {
      return "here-documents are not permitted";
    }

    if (char === " " || char === "\t") {
      pushWord();
      index += 1;
      continue;
    }
    if (char === "\n") {
      pushWord();
      tokens.push({ kind: "operator", value: ";" });
      index += 1;
      continue;
    }
    if (char === "#" && word === undefined) {
      break;
    }

    const rest = command.slice(index);
    const redirect = /^(?:&>>?|[0-9]*>&[0-9-]+|[0-9]*>>?|[0-9]*<)/.exec(rest);
    const descriptorPrefix =
      word !== undefined && /^[0-9]+$/.test(word) && (char === ">" || char === "<");
    if (redirect && (word === undefined || descriptorPrefix)) {
      const prefix = descriptorPrefix ? word : "";
      word = undefined;
      const operator = descriptorPrefix
        ? (/^(?:>&[0-9-]+|>>?|<)/.exec(rest)?.[0] ?? redirect[0])
        : redirect[0];
      tokens.push({ kind: "operator", value: `${prefix}${operator}` });
      index += operator.length;
      continue;
    }
    if (char === ">" || char === "<") {
      pushWord();
      continue;
    }

    const separator = /^(?:&&|\|\||\|&|[;|&])/.exec(rest)?.[0];
    if (separator) {
      pushWord();
      if (separator === "&") {
        return "background execution is not permitted";
      }
      tokens.push({ kind: "operator", value: separator === "|&" ? "|" : separator });
      index += separator.length;
      continue;
    }

    word = (word ?? "") + char;
    index += 1;
  }

  pushWord();
  return tokens;
}

function escapesWritableRoots(path: string): boolean {
  const absolute = posix.resolve(REPOSITORY_DIR, path);
  return !WRITABLE_ROOTS.some((root) => `${absolute}/`.startsWith(root));
}

function checkWriteTarget(path: string): string | undefined {
  if (path === "/dev/null" || path.startsWith("$")) {
    return undefined;
  }
  if (GIT_INTERNALS.test(path)) {
    return "the .git directory must not be modified";
  }
  if (escapesWritableRoots(path)) {
    return `writes are limited to the repository and /tmp (${path})`;
  }
  return undefined;
}

function firstPositional(args: readonly string[]): string | undefined {
  return args.find((arg) => !arg.startsWith("-"));
}

function checkProgram(program: string, args: readonly string[]): string | undefined {
  const denied = DENIED_PROGRAMS[program];
  if (denied) {
    return `${program}: ${denied}`;
  }

  if (WRAPPERS.has(program)) {
    const wrappedIndex = args.findIndex(
      (arg) =>
        !arg.startsWith("-") &&
        !/^[A-Za-z_][A-Za-z0-9_]*=/.test(arg) &&
        !/^[0-9.]+[smhd]?$/.test(arg),
    );
    if (wrappedIndex === -1) {
      return program === "env"
        ? "printing the environment is not useful here"
        : `${program}: no command given`;
    }
    return checkProgram(args[wrappedIndex] as string, args.slice(wrappedIndex + 1));
  }

  if (program.includes("$")) {
    return "the program name must be literal";
  }
  if (program.includes("/")) {
    if (program.startsWith("/") || program.startsWith("~") || program.split("/").includes("..")) {
      return `${program}: only repository-relative executables may be run by path`;
    }
  } else if (!ALLOWED_PROGRAMS.has(program)) {
    return `${program}: not on the list of permitted programs`;
  }

  if (args.some((arg) => GIT_INTERNALS.test(arg))) {
    return "the .git directory must not be accessed directly";
  }

  switch (program) {
    case "git": {
      const overrides = ["-c", "-C", "--exec-path", "--config-env", "--git-dir", "--work-tree"];
      if (
        args.some((arg) => overrides.some((flag) => arg === flag || arg.startsWith(`${flag}=`)))
      ) {
        return "git: configuration and directory overrides are not permitted";
      }
      const subcommand = firstPositional(args);
      if (!subcommand || !GIT_ALLOWED_SUBCOMMANDS.has(subcommand)) {
        return `git${subcommand ? ` ${subcommand}` : ""}: only inspection, restore, checkout and apply are permitted`;
      }
      return undefined;
    }
    case "cd": {
      const target = firstPositional(args);
      return target && !target.startsWith("$") && escapesWritableRoots(target)
        ? "cd: stay inside the repository or /tmp"
        : undefined;
    }
    case "npm":
    case "pnpm":
    case "yarn": {
      const subcommand = firstPositional(args);
      if (subcommand && PACKAGE_MANAGER_DENIED.has(subcommand)) {
        return `${program} ${subcommand}: dependencies and registry state are managed by the platform`;
      }
      return undefined;
    }
    case "pip":
    case "pip3": {
      const subcommand = args[0];
      return subcommand && PIP_ALLOWED.has(subcommand)
        ? undefined
        : `${program}: only list, show, freeze and check are permitted`;
    }
    case "poetry": {
      const subcommand = args[0];
      return subcommand && POETRY_ALLOWED.has(subcommand)
        ? undefined
        : "poetry: only run, check, show, version and env are permitted";
    }
    case "bash":
    case "sh": {
      if (args.some((arg) => /^-[a-z]*[cis]/.test(arg))) {
        return `${program}: run the command directly instead of through a nested shell`;
      }
      return firstPositional(args) ? undefined : `${program}: a script path is required`;
    }
    case "find":
      return args.some((arg) => FIND_DENIED.has(arg))
        ? "find: actions that execute or delete are not permitted"
        : undefined;
    default:
      break;
  }

  if (MUTATING_PROGRAMS.has(program)) {
    if (
      program === "sed" &&
      !args.some((arg) => /^-[a-zA-Z]*i/.test(arg) || arg.startsWith("--in-place"))
    ) {
      return undefined;
    }
    for (const arg of args) {
      if (arg.startsWith("-") || (program === "sed" && arg === firstPositional(args))) {
        continue;
      }
      if (program === "chmod" && /^[0-7]{3,4}$|^[ugoa]*[+=-][rwxXst]+$/.test(arg)) {
        continue;
      }
      const problem = checkWriteTarget(arg);
      if (problem) {
        return `${program}: ${problem}`;
      }
    }
  }
  return undefined;
}

export function evaluateCommand(command: string): CommandVerdict {
  if (command.trim() === "") {
    return deny("the command is empty");
  }
  if (command.length > MAX_COMMAND_LENGTH) {
    return deny(`the command is longer than ${MAX_COMMAND_LENGTH} characters`);
  }
  if (/[\x00-\x08\x0b-\x1f\x7f]/.test(command)) {
    return deny("the command contains control characters");
  }

  const tokens = tokenize(command);
  if (typeof tokens === "string") {
    return deny(tokens);
  }

  let words: string[] = [];
  let expectRedirectTarget: string | undefined;
  let sawCommand = false;

  const finishSimpleCommand = (): string | undefined => {
    const current = words;
    words = [];
    if (current.length === 0) {
      return "a command is missing around an operator";
    }
    sawCommand = true;
    const programIndex = current.findIndex((word) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word));
    if (programIndex === -1) {
      return undefined;
    }
    return checkProgram(current[programIndex] as string, current.slice(programIndex + 1));
  };

  for (const token of tokens) {
    if (token.kind === "word") {
      if (expectRedirectTarget !== undefined) {
        if (expectRedirectTarget.includes(">")) {
          const problem = checkWriteTarget(token.value);
          if (problem) {
            return deny(`redirection: ${problem}`);
          }
        }
        expectRedirectTarget = undefined;
      } else {
        words.push(token.value);
      }
      continue;
    }
    if (expectRedirectTarget !== undefined) {
      return deny("a redirection is missing its target");
    }
    if (SEPARATORS.has(token.value)) {
      const problem = finishSimpleCommand();
      if (problem) {
        return deny(problem);
      }
    } else if (!/>&[0-9-]+$/.test(token.value)) {
      expectRedirectTarget = token.value;
    }
  }

  if (expectRedirectTarget !== undefined) {
    return deny("a redirection is missing its target");
  }
  if (words.length > 0 || !sawCommand) {
    const problem = finishSimpleCommand();
    if (problem) {
      return deny(problem);
    }
  }
  return { allowed: true };
}
