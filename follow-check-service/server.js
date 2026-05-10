/**
 * GET /checkfollow?follower=USERID&target=TARGETID
 * Optional: ?secret=... if env FOLLOW_CHECK_SECRET is set (same value in Roblox script).
 *
 * Checks: follower's /followings contains target, then target's /followers contains follower.
 */

const express = require("express");

const ROBLOX_FRIENDS = "https://friends.roblox.com";
const PAGE_LIMIT = 100;
const MAX_PAGES = 80;

const app = express();

function deepContainsUserId(obj, needle) {
	const n = Math.floor(Number(needle));
	if (!Number.isFinite(n)) return false;
	if (typeof obj === "number" && Math.floor(obj + 0.5) === n) return true;
	if (typeof obj === "string" && /^\d+$/.test(obj)) {
		const parsed = parseInt(obj, 10);
		if (parsed === n) return true;
	}
	if (obj && typeof obj === "object") {
		for (const k of Object.keys(obj)) {
			if (deepContainsUserId(obj[k], needle)) return true;
		}
	}
	return false;
}

// Roblox Friends API on joskus tiukka User-Agentin suhteen; selaintyylinen UA auttaa datacenter-IP:llä.
const ROBLOX_HEADERS = {
	Accept: "application/json",
	"User-Agent":
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
};

async function fetchRobloxJson(url) {
	const res = await fetch(url, { headers: ROBLOX_HEADERS });
	const text = await res.text();
	let body;
	try {
		body = JSON.parse(text);
	} catch {
		body = null;
	}
	if (!res.ok) {
		const err = new Error(`Roblox HTTP ${res.status}`);
		err.status = res.status;
		err.body = body;
		err.snippet = text.length > 400 ? text.slice(0, 400) + "…" : text;
		throw err;
	}
	return body;
}

async function scanPagedList(ownerUserId, listName, needleUserId) {
	let cursor = "";
	for (let page = 0; page < MAX_PAGES; page++) {
		// API: limit ∈ {10,18,25,50,100}; sortOrder suositeltu (Luau-skriptin kanssa sama).
		let url = `${ROBLOX_FRIENDS}/v1/users/${ownerUserId}/${listName}?limit=${PAGE_LIMIT}&sortOrder=Desc`;
		if (cursor) {
			url += `&cursor=${encodeURIComponent(cursor)}`;
		}
		const data = await fetchRobloxJson(url);
		const arr = Array.isArray(data?.data) ? data.data : [];
		for (const entry of arr) {
			if (deepContainsUserId(entry, needleUserId)) {
				return true;
			}
		}
		const next = data?.nextPageCursor;
		if (typeof next !== "string" || next === "") {
			break;
		}
		cursor = next;
	}
	return false;
}

app.get("/health", (_req, res) => {
	res.json({ ok: true });
});

app.get("/", (_req, res) => {
	res.json({
		service: "roblox-follow-check",
		endpoint: "GET /checkfollow?follower=USERID&target=TARGETID",
	});
});

app.get("/checkfollow", async (req, res) => {
	const envSecret = process.env.FOLLOW_CHECK_SECRET;
	if (envSecret) {
		const q = req.query.secret;
		if (q !== envSecret) {
			return res.status(401).json({ error: "unauthorized" });
		}
	}

	const follower = parseInt(String(req.query.follower ?? ""), 10);
	const target = parseInt(String(req.query.target ?? ""), 10);
	if (!Number.isFinite(follower) || !Number.isFinite(target)) {
		return res.status(400).json({ error: "invalid follower or target" });
	}

	try {
		let follows = await scanPagedList(follower, "followings", target);
		if (!follows) {
			follows = await scanPagedList(target, "followers", follower);
		}
		return res.json({ follows });
	} catch (e) {
		console.error("[checkfollow]", e.message || e, e.snippet || e.body || "");
		const status = e.status >= 400 && e.status < 600 ? e.status : 502;
		return res.status(status >= 400 ? status : 502).json({
			error: "upstream_failed",
			message: String(e.message || e),
		});
	}
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
	console.log(`follow-check listening on ${port}`);
});
