import crypto from "crypto";

const TIKTOK_APP_KEY = "6kraboau1veif";
const TIKTOK_APP_SECRET = "5a65a5024ce4f4404eb0a5c03c2811258f0c0c90";
const access_token = "ROW_dLAWGQAAAABQMdKYGEpBUjZ0sPElm_vtnuUyq4GPSILl6nr-wSyPYcspN6vzmTsIKikzK8dnvK3OrdVuAGHuGE-2_9c1dkccnK85t4a7kvSjrXfJQsKLwA";
const path = "/authorization/202309/shops";

const all: Record<string, string> = {
  app_key: TIKTOK_APP_KEY,
  timestamp: String(Math.floor(Date.now() / 1000)),
};

const sortedConcat = Object.keys(all).sort().map((k) => k + all[k]).join("");
const base = TIKTOK_APP_SECRET + path + sortedConcat + TIKTOK_APP_SECRET;
const sign = crypto.createHmac("sha256", TIKTOK_APP_SECRET).update(base).digest("hex");
all.sign = sign;

const url = new URL(`https://open-api.tiktokglobalshop.com${path}`);
for (const [k, v] of Object.entries(all)) url.searchParams.set(k, v);

fetch(url.toString(), {
  headers: { "x-tts-access-token": access_token, "Content-Type": "application/json" }
})
.then(r => r.json())
.then(console.log)
.catch(console.error);
