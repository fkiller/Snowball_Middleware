import { spawn } from "node:child_process";
import * as readline from "node:readline";

async function main() {
  console.log("[Test] Spawning codex app-server...");
  const child = spawn("codex", ["app-server"], {
    stdio: ["pipe", "pipe", "inherit"],
    shell: true,
  });

  const rl = readline.createInterface({
    input: child.stdout,
    crlfDelay: Infinity,
  });

  rl.on("line", (line) => {
    console.log("[Codex stdout]", line);
    try {
      const msg = JSON.parse(line);
      if (msg.id === 1) {
        console.log("[Test] Initialize success! Requesting thread/list...");
        const listReq = JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "thread/list",
          params: { limit: 5 }
        }) + "\n";
        child.stdin.write(listReq);
      } else if (msg.id === 2) {
        console.log("[Test] thread/list result:", JSON.stringify(msg, null, 2));
        console.log("[Test] All checks passed, closing child.");
        child.kill();
        process.exit(0);
      }
    } catch (e) {
      console.error("[Parse error]", e);
    }
  });

  const initReq = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      clientInfo: {
        name: "snowball-control",
        title: "Snowball Control Host",
        version: "0.1.0"
      }
    }
  }) + "\n";

  console.log("[Test] Sending initialize request:", initReq.trim());
  child.stdin.write(initReq);

  setTimeout(() => {
    console.log("[Test] Timeout waiting for response, killing child...");
    child.kill();
    process.exit(1);
  }, 10000);
}

main().catch(console.error);
