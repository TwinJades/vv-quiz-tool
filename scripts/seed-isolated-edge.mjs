import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const extensionId = "denncmmiepljpbohhclcjcdjondnfgco";
const source = "C:/Users/11077/AppData/Local/Microsoft/Edge/User Data/Default/Secure Preferences";
const target = join(process.cwd(), ".edge-real-regression-profile", "Default", "Secure Preferences");
const original = JSON.parse(await readFile(source, "utf8"));
const isolated = JSON.parse(await readFile(target, "utf8"));
const entry = original.extensions?.settings?.[extensionId];
if (!entry || entry.path !== join(process.cwd(), "dist")) {
  throw new Error("The existing VV extension registration did not match this workspace.");
}
isolated.extensions.settings[extensionId] = entry;
const sourceMac = original.protection?.macs?.extensions?.settings?.[extensionId];
if (sourceMac) isolated.protection.macs.extensions.settings[extensionId] = sourceMac;
await writeFile(target, JSON.stringify(isolated));
console.log("VV extension registration copied into the isolated Edge profile.");
