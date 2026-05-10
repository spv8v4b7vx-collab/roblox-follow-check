/**
 * GET /checkfollow?follower=USERID&target=TARGETID
 * Optional: ?secret=... if env FOLLOW_CHECK_SECRET is set (same value in Roblox script).
 *
 * Checks: follower's /followings contains target, then target's /followers contains follower.
 * Yrittää ensin roproxy (usein vähemmän 401), sitten suora friends.roblox.com.
 */

const express = require("express");

const FRIENDS_HOSTS = ["https://friends.roproxy.com", "https://friends.roblox.com"];
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
	let lockedBase = null;
	const sortParts = ["&sortOrder=Desc", ""];

	for (let page = 0; page < MAX_PAGES; page++) {
		let decoded = null;
		let pageOk = false;

		for (const sp of sortParts) {
			let path = `/v1/users/${ownerUserId}/${listName}?limit=${PAGE_LIMIT}${sp}`;
			if (cursor) {
				path += `&cursor=${encodeURIComponent(cursor)}`;
			}
			const bases = lockedBase ? [lockedBase] : FRIENDS_HOSTS;
			for (const base of bases) {
				const url = base + path;
				try {
					decoded = await fetchRobloxJson(url);
					lockedBase = base;
					pageOk = true;
					break;
				} catch (e) {
					/* try next host / sort */
				}
			}
			if (pageOk) break;
		}

		if (!pageOk || decoded == null) {
			const err = new Error("All Friends hosts / sort variants failed for this page");
			err.status = 502;
			throw err;
		}

		const arr = Array.isArray(decoded?.data) ? decoded.data : [];
		for (const entry of arr) {
			if (deepContainsUserId(entry, needleUserId)) {
				return true;
			}
		}
		const next = decoded?.nextPageCursor;
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
		hosts: FRIENDS_HOSTS,
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

	function parseRobloxUserId(q, key) {
		const raw = q[key];
		if (raw === undefined || raw === null) {
			return NaN;
		}
		const one = Array.isArray(raw) ? raw[0] : raw;
		const n = parseInt(String(one).trim(), 10);
		if (!Number.isFinite(n) || n <= 0) {
			return NaN;
		}
		return n;
	}

	const follower = parseRobloxUserId(req.query, "follower");
	const target = parseRobloxUserId(req.query, "target");
	if (!Number.isFinite(follower) || !Number.isFinite(target)) {
		return res.status(400).json({
			error: "invalid follower or target",
			hint: "GET /checkfollow?follower=<playing user's UserId>&target=<creator UserId>",
			received: {
				follower: req.query.follower,
				target: req.query.target,
			},
		});
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
	console.log(`follow-check listening on ${port}`, FRIENDS_HOSTS.join(", "));
});
