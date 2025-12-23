import RPC from "discord-rpc";
import fetch from "node-fetch";
import FormData from "form-data";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { defaultConfig } from "./config";
import { getSettings } from "./settings";
let config = { ...defaultConfig };
let rpc = null;
let interval = null;
const CACHE_DIR = "./cache";
if (!fs.existsSync(CACHE_DIR))
    fs.mkdirSync(CACHE_DIR);
function hasValidConfig() {
    return (config.lastfmUser &&
        config.lastfmApiKey &&
        config.discordClientId);
}
async function getNowPlaying() {
    const url = `https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks` +
        `&user=${config.lastfmUser}&api_key=${config.lastfmApiKey}&format=json&limit=1`;
    const res = await fetch(url);
    const json = await res.json();
    const track = json.recenttracks?.track?.[0];
    if (!track || !track["@attr"]?.nowplaying)
        return null;
    return {
        title: track.name,
        artist: track.artist["#text"],
        album: track.album["#text"],
        image: track.image.find((i) => i.size === "extralarge")?.["#text"]
    };
}
async function uploadToCatbox(imageUrl) {
    const hash = crypto.createHash("md5").update(imageUrl).digest("hex");
    const cached = path.join(CACHE_DIR, `${hash}.txt`);
    if (fs.existsSync(cached)) {
        return fs.readFileSync(cached, "utf8");
    }
    const imgRes = await fetch(imageUrl);
    const buffer = Buffer.from(await imgRes.arrayBuffer());
    const form = new FormData();
    form.append("reqtype", "fileupload");
    form.append("fileToUpload", buffer, "cover.jpg");
    const res = await fetch("https://catbox.moe/user/api.php", {
        method: "POST",
        body: form
    });
    const url = (await res.text()).trim();
    fs.writeFileSync(cached, url);
    return url;
}
async function updatePresence() {
    if (!rpc || !hasValidConfig())
        return;
    const now = await getNowPlaying();
    if (!now || !now.image) {
        rpc.clearActivity();
        return;
    }
    const imageUrl = await uploadToCatbox(now.image);
    rpc.setActivity({
        details: now.title,
        state: `by ${now.artist}`,
        largeImageKey: imageUrl,
        largeImageText: now.album,
        instance: false
    });
}
function startRpc() {
    if (!hasValidConfig())
        return;
    rpc = new RPC.Client({ transport: "ipc" });
    rpc.on("ready", () => {
        interval = setInterval(updatePresence, 15_000);
        updatePresence();
    });
    rpc.login({ clientId: config.discordClientId });
}
function stopRpc() {
    if (interval)
        clearInterval(interval);
    interval = null;
    if (rpc) {
        rpc.clearActivity();
        rpc.destroy();
    }
    rpc = null;
}
/* ======================
   Plugin API Exports
   ====================== */
export function start() {
    startRpc();
}
export function stop() {
    stopRpc();
}
export function settings() {
    return getSettings(config, (newConfig) => {
        config = newConfig;
        stopRpc();
        startRpc();
    });
}
