import { formatApiDateTime } from "../apis/sfl-world.js";
import { config } from "../config.js";
import { ensureRepo, getLocalCommitCount, repoGit } from "./repo.js";

export interface GitLogEntry {
  hash: string;
  shortHash: string;
  date: string;
  subject: string;
  files: string[];
}

export interface GitLogOptions {
  since?: string;
  until?: string;
  limit?: number;
  filePath?: string;
}

const FIELD_SEP = "\x1f";
const COMMIT_PREFIX = "COMMIT:";

function parseGitLogOutput(raw: string): GitLogEntry[] {
  const entries: GitLogEntry[] = [];
  let current: GitLogEntry | null = null;

  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith(COMMIT_PREFIX)) {
      if (current) entries.push(current);
      const payload = line.slice(COMMIT_PREFIX.length);
      const [hash = "", date = "", subject = ""] = payload.split(FIELD_SEP);
      current = {
        hash,
        shortHash: hash.slice(0, 7),
        date,
        subject,
        files: [],
      };
      continue;
    }

    if (!current || line.length === 0) continue;
    current.files.push(line);
  }

  if (current) entries.push(current);
  return entries;
}

export async function getGitLog(options: GitLogOptions = {}): Promise<{
  branch: string;
  localCommitCount: number;
  entries: GitLogEntry[];
}> {
  await ensureRepo();
  const git = repoGit();
  const { branch } = config.repo;
  const limit = Math.min(Math.max(options.limit ?? 30, 1), 100);

  const args = [
    "log",
    branch,
    `-n`,
    String(limit),
    `--pretty=format:${COMMIT_PREFIX}%H${FIELD_SEP}%cI${FIELD_SEP}%s`,
    "--name-only",
  ];

  if (options.since?.trim()) {
    args.push(`--since=${options.since.trim()}`);
  }
  if (options.until?.trim()) {
    args.push(`--until=${options.until.trim()}`);
  }
  if (options.filePath?.trim()) {
    args.push("--", options.filePath.trim());
  }

  const raw = await git.raw(args);
  const localCommitCount = await getLocalCommitCount(git);

  return {
    branch,
    localCommitCount,
    entries: parseGitLogOutput(raw),
  };
}

export function formatGitLog(
  result: Awaited<ReturnType<typeof getGitLog>>,
  options: GitLogOptions = {},
): string {
  const { branch, localCommitCount, entries } = result;
  const lines: string[] = [
    `## Git log — origin/${branch}`,
    `- Local history: ${localCommitCount} commits on ${branch}`,
  ];

  if (options.since) lines.push(`- Since: ${options.since}`);
  if (options.until) lines.push(`- Until: ${options.until}`);
  if (options.filePath) lines.push(`- File filter: ${options.filePath}`);
  lines.push("");

  if (entries.length === 0) {
    lines.push("No commits matched. Try a wider date range or run `sfl_index` to refresh the repo.");
    return lines.join("\n");
  }

  for (const entry of entries) {
    const when = entry.date ? formatApiDateTime(new Date(entry.date).getTime()) : "unknown";
    lines.push(`### ${entry.shortHash} — ${when}`);
    lines.push(entry.subject);
    if (entry.files.length > 0) {
      const preview = entry.files.slice(0, 20);
      lines.push("", "Files:");
      for (const file of preview) {
        lines.push(`- ${file}`);
      }
      if (entry.files.length > 20) {
        lines.push(`- … and ${entry.files.length - 20} more`);
      }
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}
