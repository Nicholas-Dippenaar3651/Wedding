// One-time Google sign-in for the photo uploader. Run on your own computer: node scripts/google-login.js
//
// Needs TROUE_GOOGLE_CLIENT_ID and TROUE_GOOGLE_CLIENT_SECRET in .env (a "Desktop app" OAuth client).
// Opens Google's sign-in page in your browser; after you allow access, it writes
// TROUE_GOOGLE_REFRESH_TOKEN into .env. It never prints the token. Copy all three TROUE_GOOGLE_*
// values from .env into Render's environment settings afterwards.
//
// Scope drive.file: the app can only see and change files and folders it created itself,
// nothing else in your Drive.

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");

const ENV = path.join(__dirname, "..", ".env");
try {
  process.loadEnvFile(ENV);
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
const CLIENT_ID = process.env.TROUE_GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.TROUE_GOOGLE_CLIENT_SECRET;
const SCOPE = "https://www.googleapis.com/auth/drive.file";

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Add TROUE_GOOGLE_CLIENT_ID and TROUE_GOOGLE_CLIENT_SECRET to .env first.");
  process.exit(1);
}

// PKCE: proves the code coming back belongs to this run
const verifier = crypto.randomBytes(32).toString("base64url");
const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
const state = crypto.randomBytes(16).toString("hex");

// a throwaway local server on a free port receives Google's redirect
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if (url.pathname !== "/") return res.writeHead(404).end();
  const done = (msg, ok) => {
    res.writeHead(ok ? 200 : 400, { "Content-Type": "text/plain; charset=utf-8" }).end(msg);
    server.close();
    if (!ok) process.exitCode = 1;
  };
  if (url.searchParams.get("state") !== state) return done("Unexpected response (state mismatch). Run the script again.", false);
  if (url.searchParams.get("error")) return done(`Google said: ${url.searchParams.get("error")}`, false);

  try {
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: url.searchParams.get("code"),
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        code_verifier: verifier,
      }),
    });
    const tok = await r.json();
    if (!r.ok || !tok.refresh_token) throw new Error(tok.error_description || tok.error || "no refresh token returned");
    if (!String(tok.scope || "").split(" ").includes(SCOPE)) throw new Error("the drive.file permission wasn't granted; tick it on Google's page");
    saveToken(tok.refresh_token);
    console.log("Done: TROUE_GOOGLE_REFRESH_TOKEN saved in .env. Now copy the three TROUE_GOOGLE_* lines to Render.");
    done("Signed in. You can close this tab and go back to the terminal.", true);
  } catch (e) {
    console.error(`Sign-in failed: ${e.message}`);
    done(`Sign-in failed: ${e.message}`, false);
  }
});

// replace an existing token line, or add one; the rest of .env is left as it was
function saveToken(token) {
  const line = `TROUE_GOOGLE_REFRESH_TOKEN=${token}`;
  let text = fs.existsSync(ENV) ? fs.readFileSync(ENV, "utf8") : "";
  if (/^TROUE_GOOGLE_REFRESH_TOKEN=.*$/m.test(text)) text = text.replace(/^TROUE_GOOGLE_REFRESH_TOKEN=.*$/m, line);
  else text += (text && !text.endsWith("\n") ? "\n" : "") + line + "\n";
  fs.writeFileSync(ENV, text);
}

let redirectUri;
server.listen(0, "127.0.0.1", () => {
  redirectUri = `http://127.0.0.1:${server.address().port}`;
  const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  auth.search = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline", // ask for a refresh token
    prompt: "consent", // always issue a new one, even if signed in before
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  });
  console.log("Opening Google sign-in in your browser. If it doesn't open, paste this link into it:\n");
  console.log(auth.toString() + "\n");
  if (process.platform === "win32") execFile("rundll32", ["url.dll,FileProtocolHandler", auth.toString()]);
  else execFile(process.platform === "darwin" ? "open" : "xdg-open", [auth.toString()]);
});
