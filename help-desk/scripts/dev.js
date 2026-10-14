// Local convenience: starts store-api.js and the help desk together.
//   npm run dev            store API on 4000, help desk on 3000
// Store API settings (SLOW, FAIL, LIMIT) are passed through, e.g.
//   SLOW=0 FAIL=0 npm run dev
const { spawn } = require("child_process");
const path = require("path");

const root = path.join(__dirname, "..");
const storePort = process.env.STORE_PORT || "4000";
const appPort = process.env.PORT || "3000";

const store = spawn(process.execPath, ["store-api.js"], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, PORT: storePort },
});
const app = spawn(process.execPath, ["src/server.js"], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, PORT: appPort, STORE_API_URL: process.env.STORE_API_URL || `http://localhost:${storePort}` },
});

function stop() {
  app.kill("SIGTERM");
  store.kill("SIGTERM");
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
app.on("exit", (code) => {
  store.kill();
  process.exit(code ?? 0);
});
