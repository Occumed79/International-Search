import { Router, type IRouter } from "express";

const router: IRouter = Router();

router.get("/config/map", (_req, res) => {
  const apiKey = process.env.MAPTILER_API_KEY?.trim();

  if (!apiKey) {
    res.status(503).json({ error: "Map service is not configured." });
    return;
  }

  // Browser map keys are necessarily delivered to the client at runtime. Keeping
  // the Render variable server-side avoids baking environment-specific values
  // into the Vite bundle while still allowing the browser map SDK to initialize.
  res.setHeader("Cache-Control", "private, max-age=300");
  res.json({ apiKey });
});

export default router;
