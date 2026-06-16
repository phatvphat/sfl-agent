import { access } from "node:fs/promises";
import { simpleGit, type SimpleGit } from "simple-git";
import { config } from "../config.js";

const FETCH_CONFIG_KEY = "remote.origin.fetch";

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export function repoGit(): SimpleGit {
  return simpleGit(config.repo.path);
}

function branchFetchRefspec(branch: string): string {
  return `+refs/heads/${branch}:refs/remotes/origin/${branch}`;
}

async function configureBranchOnlyFetch(
  git: SimpleGit,
  branch: string,
  onProgress?: (message: string) => void,
): Promise<void> {
  onProgress?.(`Configuring origin to track only branch ${branch}`);
  await git.raw(["remote", "set-branches", "origin", branch]);

  try {
    await git.raw(["config", "--unset-all", FETCH_CONFIG_KEY]);
  } catch {
    // No prior fetch refspec.
  }

  await git.addConfig(FETCH_CONFIG_KEY, branchFetchRefspec(branch), false, "local");
}

async function pruneOtherRemoteBranches(
  git: SimpleGit,
  branch: string,
  onProgress?: (message: string) => void,
): Promise<void> {
  const keep = `origin/${branch}`;
  const summary = await git.branch(["-r"]);
  const removed: string[] = [];

  for (const name of summary.all) {
    const remote = name.trim();
    if (!remote.startsWith("origin/") || remote === keep || remote === "origin/HEAD") {
      continue;
    }
    try {
      await git.raw(["branch", "-dr", remote]);
      removed.push(remote);
    } catch {
      // Already gone or in use.
    }
  }

  if (removed.length > 0) {
    onProgress?.(`Removed remote-tracking branches: ${removed.join(", ")}`);
  }

  try {
    await git.raw(["remote", "prune", "origin"]);
  } catch {
    // Non-fatal.
  }
}

export async function getLocalCommitCount(git: SimpleGit = repoGit()): Promise<number> {
  const countStr = await git.raw(["rev-list", "--count", "HEAD"]);
  const count = Number.parseInt(countStr.trim(), 10);
  return Number.isFinite(count) ? count : 0;
}

async function isShallowRepository(git: SimpleGit): Promise<boolean> {
  const result = await git.raw(["rev-parse", "--is-shallow-repository"]);
  return result.trim() === "true";
}

/** Upgrade shallow clones to full main-branch history. */
async function ensureFullHistory(
  git: SimpleGit,
  branch: string,
  onProgress?: (message: string) => void,
): Promise<void> {
  if (await isShallowRepository(git)) {
    onProgress?.(`Fetching full history for origin/${branch} (was shallow clone)...`);
    await git.fetch(["--unshallow", "--prune", "origin", branch]);
  }

  const count = await getLocalCommitCount(git);
  onProgress?.(`${count} commits on ${branch}`);
}

export async function ensureRepo(onProgress?: (message: string) => void): Promise<string> {
  const { url, path: repoPath, branch } = config.repo;

  if (await pathExists(`${repoPath.replace(/[/\\]+$/, "")}/.git`)) {
    onProgress?.(`Syncing origin/${branch} in ${repoPath}`);
    const git = repoGit();
    await configureBranchOnlyFetch(git, branch, onProgress);
    await git.checkout(branch);
    await pruneOtherRemoteBranches(git, branch, onProgress);
    await ensureFullHistory(git, branch, onProgress);
    await git.pull("origin", branch, ["--ff-only"]);
    return repoPath;
  }

  onProgress?.(`Cloning ${url} -> ${repoPath} (branch ${branch} only, full history)`);
  const git = simpleGit();
  await git.clone(url, repoPath, ["--single-branch", "--branch", branch]);
  await configureBranchOnlyFetch(simpleGit(repoPath), branch);
  const count = await getLocalCommitCount(simpleGit(repoPath));
  onProgress?.(`Cloned ${count} commits on ${branch}`);
  return repoPath;
}
