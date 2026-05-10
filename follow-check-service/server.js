/**
 * GET /checkfollow?follower=USERID&target=TARGETID
 */

const express = require("express");

const FRIENDS_HOSTS = ["https://friends.roproxy.com", "https://friends.roblox.com"];
const LIMITS_FIRST_PAGE = [100, 50, 25];
const SORT_VARIANTS = ["&sortOrder=Desc", "&sortOrder=Asc", ""];
const MAX_PAGES = 80;
const FETCH_MS = 45000;

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
	"Accept-Language": "en-US,en;q=0.9",
	"User-Agent":
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
	Referer: "https://www.roblox.com/",
	Origin: "https://www.roblox.com",
};

async function fetchRobloxJson(url) {
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), FETCH_MS);
	try {
		const res = await fetch(url, { headers: ROBLOX_HEADERS, signal: ctrl.signal });
		const text = await res.text();
		let body;
		try {
			body = JSON.parse(text);
		} catch {
			body = null;
		}
		if (!res.ok) {
			const err = new Error(`HTTP ${res.status}`);
			err.status = res.status;
			err.body = body;
			err.snippet = text.length > 280 ? text.slice(0, 280) + "…" : text;
			throw err;
		}
		return body;
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Yksi sivu: kokeilee host + limit + sort -yhdistelmiä kunnes yksi onnistuu.
 * Palauttaa { data, lock } missä lock kiinnitetään seuraaviin sivuihin.
 */
async function fetchFriendsOnePage(ownerUserId, listName, cursor, lock) {
	const failures = [];
	const bases = lock?.base ? [lock.base] : FRIENDS_HOSTS;
	const limits = lock?.limit != null ? [lock.limit] : LIMITS_FIRST_PAGE;
	const sorts = lock?.sort !== undefined ? [lock.sort] : SORT_VARIANTS;

	for (const lim of limits) {
		for (const sp of sorts) {
			let path = `/v1/users/${ownerUserId}/${listName}?limit=${lim}${sp}`;
			if (cursor) {
				path += `&cursor=${encodeURIComponent(cursor)}`;
			}
			for (const base of bases) {
				const url = base + path;
				const shortHost = base.replace("https://", "");
				try {
					const data = await fetchRobloxJson(url);
					return {
						data,
						lock: {
							base,
							limit: lim,
							sort: sp,
						},
					};
				} catch (e) {
					const st = e.status ?? "abort";
					failures.push(`${shortHost} lim=${lim} → ${st} ${e.message}`);
				}
			}
		}
	}

	const msg = failures.length ? failures.join(" | ") : "no attempts";
	const err = new Error(msg);
	err.status = 502;
	err.failures = failures;
	throw err;
}

async function scanPagedList(ownerUserId, listName, needleUserId) {
	let cursor = "";
	let lock = null;

	for (let page = 0; page < MAX_PAGES; page++) {
		const { data, lock: newLock } = await fetchFriendsOnePage(ownerUserId, listName, cursor || "", lock);
		lock = newLock;

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
		console.error("[checkfollow]", e.message || e);
		const status = e.status >= 400 && e.status < 600 ? e.status : 502;
		return res.status(status >= 400 ? status : 502).json({
			error: "upstream_failed",
			message: String(e.message || e),
			detail: e.failures ? e.failures.slice(0, 20) : undefined,
		});
	}
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
	console.log(`follow-check listening on ${port}`);
});
