import { UserError } from "./errors.js";
import { DEFAULT_MAX_DIFF_BYTES, DEFAULT_MODEL } from "./summarize.js";

export const USAGE = `jhhzzy - JHHZZY PR Agent

Turns the work in your checkout into a branch, a commit, a push, and an opened
pull request whose title and description are written by Claude from the diff.

Usage
  jhhzzy [options]
  jhhzzy pr [options]

Options
  -b, --branch <name>      Branch to commit and push to (default: current branch,
                           or one generated from the title when you are on the base branch)
      --base <branch>      Base branch for the pull request (default: the remote's default branch)
      --remote <name>      Git remote to push to (default: origin)
      --title <text>       Use this title instead of asking Claude
      --body <text>        Use this body instead of asking Claude
      --body-file <path>   Read the body from a file
  -m, --commit-message <t> Commit message (default: the pull request title)
      --draft              Open the pull request as a draft
      --no-ai              Skip Claude and use a description generated from commits and files
      --model <id>         Claude model to use (default: ${DEFAULT_MODEL})
      --max-diff-bytes <n> Truncate the diff sent to Claude (default: ${DEFAULT_MAX_DIFF_BYTES})
      --no-commit          Do not commit; use what is already committed on the branch
      --no-push            Do not push (implies no pull request)
      --dry-run            Print what would happen; make no commits, pushes, or pull requests
  -y, --yes                Do not ask for confirmation
  -h, --help               Show this help
  -v, --version            Show the version

Environment
  GITHUB_TOKEN             Token used to open the pull request (GH_TOKEN also works)
  ANTHROPIC_API_KEY        Credentials for Claude; without them jhhzzy falls back to --no-ai
`;

const FLAGS_WITH_VALUES = new Set([
  "branch",
  "base",
  "remote",
  "title",
  "body",
  "body-file",
  "commit-message",
  "model",
  "max-diff-bytes",
]);

const ALIASES = new Map([
  ["-b", "--branch"],
  ["-m", "--commit-message"],
  ["-y", "--yes"],
  ["-h", "--help"],
  ["-v", "--version"],
]);

export function parseArgs(argv) {
  const options = {
    command: "pr",
    remote: "origin",
    draft: false,
    dryRun: false,
    commit: true,
    push: true,
    useAi: true,
    yes: false,
    help: false,
    version: false,
    model: DEFAULT_MODEL,
    maxDiffBytes: DEFAULT_MAX_DIFF_BYTES,
  };

  const args = [...argv];
  if (args[0] && !args[0].startsWith("-")) {
    const command = args.shift();
    if (command !== "pr") throw new UserError(`unknown command: ${command}`, { hint: "the only command is `pr`" });
  }

  for (let i = 0; i < args.length; i += 1) {
    const raw = args[i];
    const arg = ALIASES.get(raw) ?? raw;

    if (!arg.startsWith("--")) throw new UserError(`unexpected argument: ${raw}`);

    let name = arg.slice(2);
    let value = null;
    const eq = name.indexOf("=");
    if (eq !== -1) {
      value = name.slice(eq + 1);
      name = name.slice(0, eq);
    }

    if (FLAGS_WITH_VALUES.has(name)) {
      if (value === null) {
        value = args[i + 1];
        i += 1;
      }
      if (value === undefined) throw new UserError(`--${name} requires a value`);
    } else if (value !== null) {
      throw new UserError(`--${name} does not take a value`);
    }

    switch (name) {
      case "branch": options.branch = value; break;
      case "base": options.base = value; break;
      case "remote": options.remote = value; break;
      case "title": options.title = value; break;
      case "body": options.body = value; break;
      case "body-file": options.bodyFile = value; break;
      case "commit-message": options.commitMessage = value; break;
      case "model": options.model = value; break;
      case "max-diff-bytes": {
        const parsed = Number.parseInt(value, 10);
        if (!Number.isFinite(parsed) || parsed <= 0) throw new UserError(`--max-diff-bytes must be a positive integer, got ${value}`);
        options.maxDiffBytes = parsed;
        break;
      }
      case "draft": options.draft = true; break;
      case "dry-run": options.dryRun = true; break;
      case "no-commit": options.commit = false; break;
      case "no-push": options.push = false; break;
      case "no-ai": options.useAi = false; break;
      case "yes": options.yes = true; break;
      case "help": options.help = true; break;
      case "version": options.version = true; break;
      default:
        throw new UserError(`unknown option: ${arg}`, { hint: "run `jhhzzy --help` for the full list" });
    }
  }

  if (options.title !== undefined && options.title.trim() === "") throw new UserError("--title cannot be empty");
  if (options.body !== undefined && options.bodyFile !== undefined) throw new UserError("--body and --body-file are mutually exclusive");

  return options;
}
