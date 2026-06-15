# Render Keep-Awake

A pnpm workspace package was found, but the standard Express app path was not found at `artifacts/api-server/src/app.ts`, so no framework-specific health endpoint was added automatically.

For Render web services, add or use a lightweight endpoint that returns HTTP 200, then monitor it externally.

Recommended endpoint path:

```txt
/api/health
```

Use the deployed Render URL with the health path:

```txt
https://YOUR-RENDER-SERVICE.onrender.com/api/health
```

Ping interval recommendation: every 10-14 minutes.
