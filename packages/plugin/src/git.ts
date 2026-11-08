import { execFileSync } from "node:child_process";
import path from "node:path";

export type RepositoryInformation = {
  rootPath: string;
  remoteUrl: string;
  branch: string | undefined;
};

export type GitIdentity = {
  email: string;
  displayName: string;
};

function git(workingDirectory: string, gitArguments: string[]): string | undefined {
  try {
    const output = execFileSync("git", gitArguments, {
      cwd: workingDirectory,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2_000,
    }).trim();
    return output === "" ? undefined : output;
  } catch {
    return undefined;
  }
}

export function repositoryInformation(workingDirectory: string): RepositoryInformation | undefined {
  const isInsideRepository = git(workingDirectory, ["rev-parse", "--is-inside-work-tree"]) === "true";
  if (!isInsideRepository) {
    return undefined;
  }
  const rootPath = path.resolve(workingDirectory, git(workingDirectory, ["rev-parse", "--show-cdup"]) ?? "");
  const firstRemote = git(rootPath, ["remote"])?.split("\n")[0];
  let remoteUrl = git(rootPath, ["remote", "get-url", "origin"]);
  if (!remoteUrl && firstRemote) {
    remoteUrl = git(rootPath, ["remote", "get-url", firstRemote]);
  }
  return {
    rootPath,
    remoteUrl: remoteUrl ?? rootPath,
    branch: git(rootPath, ["branch", "--show-current"]),
  };
}

export function gitIdentity(workingDirectory: string): GitIdentity | undefined {
  const email = git(workingDirectory, ["config", "user.email"]);
  if (!email) {
    return undefined;
  }
  return { email, displayName: git(workingDirectory, ["config", "user.name"]) ?? email };
}
