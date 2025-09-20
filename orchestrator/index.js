import express from "express";
import fetch from "node-fetch";
import { createClient } from "redis";
import { ChatGroq } from "@langchain/groq";
import "dotenv/config";
import cors from "cors";

async function start() {
  const app = express();
  app.use(express.json());
  app.use(cors());

  const PORT = Number(process.env.ORCHESTRATOR_PORT);
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY missing in env");
    process.exit(1);
  }

  let redis;
  try {
    redis = createClient({
      socket: {
        host: process.env.REDIS_HOST,
        port: Number(process.env.REDIS_PORT),
      },
      username: process.env.REDIS_USERNAME,
      password: process.env.REDIS_PASSWORD,
    });
    redis.on("error", (e) => console.error("Redis error:", e));
    await redis.connect();
    console.log("Redis connected");
  } catch (err) {
    console.warn("Redis not available:", err.message);
    redis = null;
  }

  // LLM
  const llm = new ChatGroq({
    apiKey: OPENAI_API_KEY,
    model: process.env.LLM_MODEL || "openai/gpt-oss-120b",
    temperature: 0,
  });

  // Tools
  const WEATHER_URL = process.env.WEATHER_URL;
  const MATH_URL = process.env.MATH_URL;

  const tools = {
    "weather.get_weather": {
      endpoint: `${WEATHER_URL}/call/get_weather`,
      description: "Get weather for a city. Args: { city: string }",
    },
    "math.calculate": {
      endpoint: `${MATH_URL}/call/calculate`,
      description: "Evaluate a math expression. Args: { expression: string }",
    },
  };

  async function callTool(endpoint, args) {
    const r = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ args }),
    });
    if (!r.ok) {
      throw new Error(`Tool call failed (${r.status}): ${await r.text()}`);
    }
    return r.json();
  }

  // System prompt
  const SYSTEM_PROMPT = `You are an AI orchestrator. You MUST respond ONLY in JSON.
Available tools:
- weather.get_weather: Args { city: string }
- math.calculate: Args { expression: string }

Rules:
- To call a tool: {"action":"call","tool":"weather.get_weather","args":{"city":"Dubai"}}
- You MAY return multiple tool calls at once in a JSON array.
- After tool calls, ALWAYS provide one final answer:
  {"action":"answer","result":"<final text>"}
- NEVER output plain text outside JSON.`;

  const MAX_LOOPS = 8;

  app.post("/api/ask", async (req, res) => {
    const q = req.body?.question;
    if (!q) return res.status(400).json({ error: "question required" });

    console.log("Q:", q);

    let finalResult = null;
    const conversation = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: q },
    ];

    for (let loop = 0; loop < MAX_LOOPS; loop++) {
      let responseText = "";
      try {
        const resp = await llm.invoke(conversation);
        responseText = (resp.text ?? resp.content ?? "").trim();
      } catch (err) {
        return res
          .status(500)
          .json({ error: "LLM failed", details: err.message });
      }

      console.log("LLM raw:", responseText);

      let parsedList = [];
      try {
        parsedList = JSON.parse(responseText);
        if (!Array.isArray(parsedList)) parsedList = [parsedList];
      } catch {
        const matches = responseText.match(/\{[^{}]*\}/g);
        if (matches) {
          parsedList = matches
            .map((m) => {
              try {
                return JSON.parse(m);
              } catch {
                return null;
              }
            })
            .filter(Boolean);
        }
      }

      if (parsedList.length === 0) {
        conversation.push({
          role: "user",
          content: "Invalid response. Please output valid JSON only.",
        });
        continue;
      }

      const collected = {};
      let hasAnswer = false;

      for (const parsed of parsedList) {
        if (parsed.action === "answer") {
          finalResult = parsed.result;
          hasAnswer = true;
          break;
        }

        if (parsed.action === "call" && tools[parsed.tool]) {
          try {
            const toolRes = await callTool(
              tools[parsed.tool].endpoint,
              parsed.args || {}
            );
            console.log(`Tool ${parsed.tool} ->`, toolRes);

            collected[parsed.tool] = toolRes;

            conversation.push({
              role: "assistant",
              content: JSON.stringify(parsed),
            });
            conversation.push({
              role: "user",
              content: `Tool ${parsed.tool} result: ${JSON.stringify(toolRes)}`,
            });
          } catch (err) {
            conversation.push({
              role: "user",
              content: `Tool ${parsed.tool} failed: ${err.message}. Try answering anyway.`,
            });
          }
        }
      }

      if (Object.keys(collected).length > 0 && !hasAnswer) {
        conversation.push({
          role: "user",
          content: `You now have results: ${JSON.stringify(
            collected
          )}. Please respond with {"action":"answer","result":"..."} only.`,
        });
        continue;
      }

      if (finalResult) break;
    }

    if (!finalResult) {
      finalResult = "Unable to complete request.";
    }
    res.json({ result: finalResult });
  });

  app.listen(PORT, () => console.log(`Orchestrator running on ${PORT}`));
}

start().catch((err) => {
  console.error("Startup failed:", err);
  process.exit(1);
});
