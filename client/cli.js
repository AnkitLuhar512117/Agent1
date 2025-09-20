import readline from "readline";
import fetch from "node-fetch";
import "dotenv/config";

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL;

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: "> ",
});

console.log("MCP CLI client — type 'exit' to quit");
rl.prompt();

rl.on("line", async (line) => {
  const q = line.trim();
  if (!q || q.toLowerCase() === "exit") {
    rl.close();
    return;
  }

  try {
    const resp = await fetch(`${ORCHESTRATOR_URL}/api/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: q }),
    });

    if (!resp.ok) {
      console.error(`Request failed: ${resp.status} ${resp.statusText}`);
      rl.prompt();
      return;
    }

    const data = await resp.json();

    let output = data.result;

    try {
      const parts = output
        .split("\n")
        .map((p) => p.trim())
        .filter((p) => p);

      if (parts.length > 1) {
        const parsed = parts.map((p) => JSON.parse(p));
        console.log("→", JSON.stringify(parsed, null, 2));
      } else {
        try {
          console.log("→", JSON.stringify(JSON.parse(output), null, 2));
        } catch {
          console.log("→", output);
        }
      }
    } catch (err) {
      console.log("→", output);
    }
  } catch (err) {
    console.error("Error:", err.message);
  }

  rl.prompt();
});

rl.on("close", () => {
  console.log("Bye!");
  process.exit(0);
});
