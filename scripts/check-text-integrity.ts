import { execFileSync } from "child_process";
import path from "path";
import { readFileSync } from "fs";

type Args = {
  root: string;
  files: string[];
};

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const IGNORED_DIR_PREFIXES = [
  ".git/",
  "node_modules/",
  "build/",
  "dist/",
  "logs/",
  "out/",
  ".cache/",
];
const EXACT_TEXT_FILES = new Set([
  ".editorconfig",
  ".gitattributes",
  ".gitignore",
  ".dockerignore",
  "AGENTS.md",
  "Dockerfile",
  "README.md",
]);
const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".json",
  ".jsonc",
  ".md",
  ".txt",
  ".yml",
  ".yaml",
  ".html",
  ".css",
  ".scss",
  ".less",
  ".sql",
  ".sh",
  ".ps1",
  ".env",
  ".properties",
]);
const MOJIBAKE_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\uFFFD/g, reason: "replacement character" },
  { pattern: /Ã|Â|â€|â€™|â€œ|â€\x9d|ðŸ/g, reason: "UTF-8 decoded as ANSI/Windows-1252" },
  { pattern: /ä¸|å.|æ.|ç.|ï¼/g, reason: "UTF-8 decoded as Latin-1-style mojibake" },
  { pattern: /銝|嚗|蝡||||/g, reason: "common CJK mojibake signatures seen in this repo" },
];

function parseArgs(argv: string[]): Args {
  let root = process.cwd();
  const files: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") {
      const next = argv[index + 1];
      if (!next) throw new Error("Missing value for --root");
      root = path.resolve(next);
      index += 1;
      continue;
    }

    files.push(normalizeGitPath(arg));
  }

  return { root, files };
}

function normalizeGitPath(relPath: string): string {
  return relPath.replace(/\\/g, "/");
}

function isIgnored(relPath: string): boolean {
  return IGNORED_DIR_PREFIXES.some((prefix) => relPath.startsWith(prefix));
}

function isPolicyTextFile(relPath: string): boolean {
  const normalized = normalizeGitPath(relPath);
  const basename = path.posix.basename(normalized);

  if (EXACT_TEXT_FILES.has(normalized) || EXACT_TEXT_FILES.has(basename)) {
    return true;
  }

  if (basename.startsWith("Dockerfile.")) {
    return true;
  }

  if (basename.startsWith(".env")) {
    return true;
  }

  return TEXT_EXTENSIONS.has(path.posix.extname(normalized));
}

function matchesRequestedFiles(relPath: string, requestedFiles: string[]): boolean {
  if (requestedFiles.length === 0) return true;

  return requestedFiles.some((requested) => {
    const normalized = normalizeGitPath(requested);
    return (
      relPath === normalized ||
      relPath.startsWith(`${normalized}/`) ||
      path.posix.basename(relPath) === normalized
    );
  });
}

function getTrackedFiles(root: string, requestedFiles: string[]): string[] {
  const output = execFileSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "buffer",
  });

  return output
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map(normalizeGitPath)
    .filter((relPath) => !isIgnored(relPath))
    .filter((relPath) => matchesRequestedFiles(relPath, requestedFiles))
    .filter((relPath) => isPolicyTextFile(relPath));
}

function decodeUtf8(buffer: Buffer): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
}

function detectLineEndingIssues(text: string): string[] {
  const issues: string[] = [];
  const hasCrlf = /\r\n/.test(text);
  const hasBareLf = /(?<!\r)\n/.test(text);
  const hasBareCr = /\r(?!\n)/.test(text);

  if (hasBareCr) issues.push("contains CR-only line endings");
  if (hasCrlf && hasBareLf) issues.push("contains mixed CRLF/LF line endings");
  else if (hasCrlf) issues.push("contains CRLF line endings; repo policy is LF");

  return issues;
}

function detectMojibake(text: string): string[] {
  const hits = new Set<string>();

  for (const { pattern, reason } of MOJIBAKE_PATTERNS) {
    pattern.lastIndex = 0;
    const matches = text.match(pattern);
    if (!matches || matches.length === 0) continue;
    if (reason === "replacement character" || matches.length >= 2) {
      hits.add(reason);
    }
  }

  return [...hits];
}

function main() {
  const { root, files: requestedFiles } = parseArgs(process.argv.slice(2));
  const files = getTrackedFiles(root, requestedFiles);
  const failures: Array<{ file: string; issues: string[] }> = [];

  for (const relPath of files) {
    const absPath = path.join(root, relPath);
    const raw = readFileSync(absPath);
    const hasBom = raw.subarray(0, 3).equals(UTF8_BOM);
    const body = hasBom ? raw.subarray(3) : raw;
    const issues: string[] = [];

    let text = "";
    try {
      text = decodeUtf8(body);
    } catch {
      failures.push({
        file: relPath,
        issues: ["is not valid UTF-8"],
      });
      continue;
    }

    if (hasBom) {
      issues.push("contains UTF-8 BOM; repo policy is plain UTF-8");
    }

    issues.push(...detectLineEndingIssues(text));

    const mojibakeIssues = detectMojibake(text);
    if (mojibakeIssues.length > 0) {
      issues.push(`contains mojibake indicators: ${mojibakeIssues.join(", ")}`);
    }

    if (issues.length > 0) {
      failures.push({ file: relPath, issues });
    }
  }

  if (failures.length === 0) {
    console.log(`OK: checked ${files.length} tracked text files.`);
    return;
  }

  console.error(`FAIL: found issues in ${failures.length} tracked text files.`);
  for (const failure of failures) {
    console.error(`- ${failure.file}`);
    for (const issue of failure.issues) {
      console.error(`  - ${issue}`);
    }
  }
  process.exit(1);
}

main();
