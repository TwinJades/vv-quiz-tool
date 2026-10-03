import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { CdpClient, cdpJson } from "./cdp-client.mjs";

const directory = resolve(import.meta.dirname, "../.browser-regression-runtime", `edge-launch-${Date.now()}`);
await mkdir(directory, { recursive: true });
const profile = resolve(directory, "profile");
const report = { directory, profile, headless: true, exit: null, version: null, error: null };
const child = spawn("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", [
  "--headless", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run",
  "--no-default-browser-check", "--disable-gpu", "--no-sandbox", "about:blank",
], { windowsHide: true, stdio: "ignore" });
child.on("exit", (code, signal) => { report.exit = { code, signal }; });
child.on("error", error => { report.error = error.message; });
let control;
try {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const port = Number((await readFile(resolve(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]);
      const version = await cdpJson(port, "/json/version");
      report.version = version.Browser;
      control = new CdpClient(version.webSocketDebuggerUrl);
      break;
    } catch { await new Promise(resolve => setTimeout(resolve, 200)); }
  }
  if (!control) report.error ||= "No CDP endpoint appeared in the fresh owned profile";
} finally {
  if (control) { try { await control.send("Browser.close"); } catch {} control.close(); }
  else if (child.exitCode === null) child.kill();
  await writeFile(resolve(directory, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
