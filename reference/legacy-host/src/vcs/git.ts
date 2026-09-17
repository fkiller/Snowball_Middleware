import * as cp from "node:child_process";
import * as path from "node:path";

export interface ChangedFile {
  path: string;
  name: string;
  status: string; // 'M', 'A', 'D', '??', etc.
  additions: number;
  deletions: number;
}

export class GitProvider {
  /**
   * Get list of changed/untracked files in the repository
   */
  public static async getChangedFiles(cwd = process.cwd()): Promise<ChangedFile[]> {
    return new Promise((resolve) => {
      // Use -u to expand untracked directories into individual files
      cp.exec("git status --porcelain -u", { cwd, windowsHide: true }, (err, stdout) => {
        if (err || !stdout) {
          return resolve([]);
        }

        const lines = stdout.split(/\r?\n/);
        const files: ChangedFile[] = [];

        for (const line of lines) {
          if (!line || line.length < 4) continue;
          const status = line.slice(0, 2).trim();
          const filePath = line.slice(3).replace(/^"|"$/g, "").trim();
          if (filePath.endsWith("/") || filePath.endsWith("\\")) continue;

          const name = path.basename(filePath);

          files.push({
            path: filePath,
            name,
            status: status || "M",
            additions: 0,
            deletions: 0,
          });
        }

        resolve(files);
      });
    });
  }

  /**
   * Get unified diff lines for a specific file
   */
  public static async getFileDiff(filePath: string, cwd = process.cwd()): Promise<string[]> {
    return new Promise((resolve) => {
      // Try unstaged + staged diff
      const cmd = `git diff HEAD -- "${filePath}"`;
      cp.exec(cmd, { cwd, windowsHide: true }, (err, stdout) => {
        if (!err && stdout && stdout.trim()) {
          const lines = stdout.split("\n").map(l => l.replace(/\r$/, ""));
          return resolve(lines);
        }

        // If untracked file or new file, diff against empty
        cp.exec(`git diff --no-index /dev/null "${filePath}"`, { cwd, windowsHide: true }, (_err2, stdout2) => {
          if (stdout2 && stdout2.trim()) {
            return resolve(stdout2.split("\n").map(l => l.replace(/\r$/, "")));
          }

          // Fallback: read file directly
          try {
            const fs = require("node:fs");
            const fullPath = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);
            if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
              const content = fs.readFileSync(fullPath, "utf8");
              const lines = content.split("\n").slice(0, 500).map((l: string) => `+ ${l.replace(/\r$/, "")}`);
              return resolve([`+++ ${filePath}`, "@@ -0,0 +1," + lines.length + " @@", ...lines]);
            }
          } catch {}

          resolve([`No changes detected for ${filePath}`]);
        });
      });
    });
  }
}
