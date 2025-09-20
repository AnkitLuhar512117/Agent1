import express from "express";
import cors from "cors";
import "dotenv/config";
import { evaluate } from "mathjs";

async function start() {
  const app = express();
  app.use(express.json());
  app.use(cors());

  const PORT = Number(process.env.MATH_PORT || 3002);

  //SSE setup
  const sseClients = new Set();
  app.get("/sse", (req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });
    res.write("\n");
    sseClients.add(res);
    req.on("close", () => sseClients.delete(res));
  });

  function broadcast(data) {
    const payload = `data: ${JSON.stringify(data)}\n\n`;
    for (const r of sseClients) {
      try {
        r.write(payload);
      } catch (e) {
        console.warn("SSE client write failed:", e.message);
      }
    }
  }

  // math endpoint
  app.post("/call/calculate", (req, res) => {
    const expr = req.body?.args?.expression;
    if (!expr) return res.status(400).json({ error: "expression required" });

    try {
      const result = evaluate(expr);
      const out = { expression: expr, result };
      broadcast({ type: "math_result", payload: out });
      return res.json(out);
    } catch (err) {
      const msg = String(err?.message ?? err);
      console.error("❌ Math evaluation error:", msg);
      broadcast({ type: "math_error", error: msg });
      return res.status(500).json({ error: msg });
    }
  });

  // healthcheck
  app.get("/healthz", (_, res) => res.json({ status: "ok" }));

  app.listen(PORT, () => console.log(`🧮 Math server listening on ${PORT}`));
}

start().catch((err) => {
  console.error("Math server failed to start:", err);
  process.exit(1);
});
