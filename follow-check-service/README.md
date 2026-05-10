# Follow check (Render)

Small Express service that calls Roblox `friends.roblox.com` from a normal server IP and exposes:

`GET /checkfollow?follower=<userId>&target=<userId>` → `{ "follows": true | false }`

Optional: set env `FOLLOW_CHECK_SECRET` and pass `?secret=...` on every request.

## Deploy on Render (free)

1. Push this folder (`follow-check-service`) to GitHub, **or** upload as a package.
2. [Render Dashboard](https://dashboard.render.com) → **New +** → **Web Service**.
3. Connect the repo; set **Root Directory** to `follow-check-service` if the repo root is the parent `Roblox` folder.
4. **Runtime:** Node, **Build Command:** `npm install`, **Start Command:** `npm start`.
5. **Instance type:** Free (cold starts ~50s are normal).
6. (Recommended) **Environment** → add `FOLLOW_CHECK_SECRET` with a long random string; use the same value in `FollowRewardsServer` as `EXTERNAL_FOLLOW_CHECK_SECRET` and requests become  
   `/checkfollow?follower=...&target=...&secret=...`
7. After deploy, copy the URL (e.g. `https://roblox-follow-check.onrender.com`).

## Roblox game

In `FollowRewardsServer.luau` set:

```lua
local EXTERNAL_FOLLOW_CHECK_BASE_URL = "https://your-service.onrender.com"
local EXTERNAL_FOLLOW_CHECK_SECRET = "" -- same as Render env if you use one
```

Leave `EXTERNAL_FOLLOW_CHECK_BASE_URL` empty to use the built-in `friends.roblox.com` requests from the game server instead.

## Local run

```bash
cd follow-check-service
npm install
npm start
# PORT defaults to 3000 — http://localhost:3000/checkfollow?follower=1&target=2
```
