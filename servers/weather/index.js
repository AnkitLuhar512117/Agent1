import express from "express";
import fetch from "node-fetch";
import { createClient } from "redis";
import cors from "cors";
import "dotenv/config";

async function start() {
  const app = express();
  app.use(express.json());
  app.use(cors());

  const PORT = Number(process.env.WEATHER_PORT || 3001);
  const WEATHER_API_KEY = process.env.WEATHER_API_KEY;

  // Redis setup (optional)
  let redis = null;
  let redisConnected = false;
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
    redisConnected = true;
    console.log("✅ Weather: connected to Redis");
  } catch (e) {
    console.warn("⚠️ Weather: Redis not available, continuing without cache");
  }

  // --- SSE support ---
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
      } catch {}
    }
  }

  // --- Helpers ---
  async function incrHit(key) {
    if (!redisConnected) return 1;
    try {
      const n = await redis.incr(`${key}:hits`);
      if (n === 1) await redis.expire(`${key}:hits`, 3600);
      return n;
    } catch (e) {
      console.warn("Hit counter error:", e.message);
      return 1;
    }
  }

  // --- Main endpoint ---
  app.post("/call/get_weather", async (req, res) => {
    const city = req.body?.args?.city;
    if (!city) return res.status(400).json({ error: "city required" });

    const key = `weather:${city.toLowerCase()}`;

    try {
      // cache check
      if (redisConnected) {
        const cached = await redis.get(key);
        if (cached) {
          const payload = JSON.parse(cached);
          broadcast({ type: "weather_cache", city, payload });
          return res.json(payload);
        }
      }

      // track usage
      const hits = await incrHit(key);

      // mock fallback if no API key
      if (!WEATHER_API_KEY) {
        const mock = {
          city,
          temperature: Math.round(Math.random() * 30 + 5),
          condition: ["sunny", "cloudy", "rainy", "windy"][
            Math.floor(Math.random() * 4)
          ],
          humidity: Math.round(Math.random() * 100),
          windSpeed: Math.round(Math.random() * 10),
          fetchedAt: new Date().toISOString(),
          source: "mock",
        };
        if (redisConnected && hits >= 3) {
          await redis.set(key, JSON.stringify(mock), { EX: 300 });
        }
        broadcast({ type: "weather_fetched", city, payload: mock });
        return res.json(mock);
      }

      // --- real API ---
      const geoUrl = `http://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(
        city
      )}&limit=1&appid=${WEATHER_API_KEY}`;
      const geoResp = await fetch(geoUrl);
      if (!geoResp.ok) throw new Error(`geocoding failed: ${geoResp.status}`);
      const geoJson = await geoResp.json();
      if (!geoJson?.length) throw new Error("city not found");
      const { lat, lon } = geoJson[0];

      const weatherUrl = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=metric&appid=${WEATHER_API_KEY}`;
      const weatherResp = await fetch(weatherUrl);
      if (!weatherResp.ok)
        throw new Error(`weather fetch failed: ${weatherResp.status}`);
      const weatherJson = await weatherResp.json();

      const out = {
        city,
        lat,
        lon,
        temperature: weatherJson.main?.temp ?? null,
        condition: weatherJson.weather?.[0]?.description ?? null,
        humidity: weatherJson.main?.humidity ?? null,
        windSpeed: weatherJson.wind?.speed ?? null,
        fetchedAt: new Date().toISOString(),
        source: "openweathermap",
      };

      if (redisConnected && hits >= 3) {
        await redis.set(key, JSON.stringify(out), { EX: 300 });
      }

      broadcast({ type: "weather_fetched", city, payload: out });
      return res.json(out);
    } catch (err) {
      console.error("❌ Weather error:", err.message);
      broadcast({
        type: "weather_error",
        city,
        error: String(err?.message ?? err),
      });
      return res.status(500).json({ error: String(err?.message ?? err) });
    }
  });

  // Health check
  app.get("/healthz", (_, res) =>
    res.json({ status: "ok", redis: redisConnected })
  );

  app.listen(PORT, () => console.log(`🌤️ Weather server listening on ${PORT}`));
}

start().catch((err) => {
  console.error("Weather server start failed:", err);
  process.exit(1);
});
