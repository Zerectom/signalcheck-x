# SignalCheck — X / Twitter Visibility Checker

A responsive, deployable site for checking **search ban**, **search suggestion ban**, **ghost ban**, and **reply deboosting** signals on X (Twitter). Built with **Node.js 20+ and vanilla HTML/CSS/JavaScript**. No npm dependencies, no database, and no X account authorization.

**Important:** This tool is *not* an official X shadowban detector. Search-result disappearance has multiple explanations; an absence from a search or reply thread isn't proof of a punitive restriction. Results distinguish measured signals from user observations and inconclusive evidence.

## What works

| Signal | With `SORSA_API_KEY` | Without a key |
| --- | --- | --- |
| Search ban | Automatic provider measurement | Guided, direct X search + self-report |
| Search suggestion ban | Automatic provider measurement | Guided, typeahead test + self-report |
| Ghost ban / thread visibility | Guided, viewer-dependent | Guided, viewer-dependent |
| Reply deboosting | Guided, viewer-dependent | Guided, viewer-dependent |
| Account privacy | Read from provider if supplied | User can inspect in X |

Only the two provider-supported automatic checks are labeled **Automatic**. Guided checks explicitly display **reported** evidence. Unknown is never treated as clean.

## Quick start on your computer

1. Install Node.js 20 or newer.
2. Open a terminal in this folder.
3. Run `npm start`.
4. Visit **http://localhost:3000**. The guided checker works immediately, no key required.
5. Optional automatic measurements: set `SORSA_API_KEY` in your terminal/environment, then start the server again.

On macOS / Linux:

```bash
export SORSA_API_KEY='your-key-here'
npm start
```

On PowerShell:

```powershell
$env:SORSA_API_KEY='your-key-here'
npm start
```

The provider's published interface (as of October 2026) is `GET https://api.sorsa.io/v3/check-shadowban` with an `ApiKey` header and a `username` query parameter. Obtain your own key from [Sorsa](https://api.sorsa.io/). Provider account, pricing, quotas and terms are independent of this project. The provider advertises introductory free requests, but check current plans before launch. The app has **no API key bundled**. You cannot run real automatic measurements without a functioning key and provider service.

## Publish it online: Render

1. Create a repository on GitHub and push all of the project files (do **not** commit a `.env` file or your key).
2. In [Render](https://dashboard.render.com/), select **New → Web Service**, connect the repository and choose the Node runtime. Alternatively, Render can use the included `render.yaml` blueprint.
3. Use **Build command:** `npm install` and **Start command:** `npm start`. Select an available plan.
4. In the web service's **Environment** settings, add `SORSA_API_KEY` with your secret key to enable automatic results. Without it, the site will offer guided checks.
5. Deploy. Render supplies the `PORT` setting. Add a custom domain from the service settings if you own one.

Free service availability and limits may change. Your own API costs and monthly budget depend on traffic.

## Deployment checklist

- Replace the brand name, site description and meta tags if desired.
- Set `SORSA_API_KEY` **only** on the server. Never add it to `public/app.js` or HTML.
- Test with accounts you know, including protected accounts and accounts without recent public posts.
- Set an appropriate budget for provider usage, configure alerts if available, and monitor errors.
- Default per-process throttle: **12 checks per IP every 10 minutes** (includes cached checks). This is basic abuse protection, **not** a distributed limiter. For significant public traffic, add a shared durable rate limiter at the edge (e.g. through your hosting platform) and enforce strict spend limits. The server caches successful per-handle results for up to **one hour**; the provider also caches shadowban results for up to one hour.
- The public username is sent to the site server and, if configured, to Sorsa. The project doesn't collect passwords or require X login. Browser URL parameters may contain the public handle. The server has no persistence or user database, but transient rate-limit and result maps are kept in RAM. Hosting/provider logs and retention are governed by their respective policies.
- Do not tell users your tool can detect account-level enforcement, all reach restrictions, or a ghost ban automatically; it cannot.
- Review the provider terms and X's policies before launching a monetized or high-traffic service. An independent third-party provider is not an official X service.

## Server endpoints

- `GET /` — site
- `GET /api/config` — whether automatic mode is configured (does not expose the key)
- `POST /api/check` — JSON `{ "username": "@handle" }`; automatically tests two signals when configured
- `GET /health` — health check

Provider status values are `clean`, `banned`, or `unknown`; the UI maps them to **no signal**, **signal found**, and **inconclusive** rather than claiming an official penalty. Return statuses can change in the future; integration code may require updates if the provider changes its response format.

## Tests

```bash
npm test
```

Tests cover handle parsing, normalizing provider results, private-account behavior, server-side key secrecy, response caching, guided fallback, basic rate limiting and static-file serving. They use a **mock provider**, not a live Sorsa account. Live API success requires your own credential.

## Authoritative background

- [X: About search rules and restrictions](https://help.x.com/en/rules-and-policies/x-search-policies)
- [X: Help with X search](https://help.x.com/en/using-x/x-search-not-working)
- [X: Search recommendations and typeahead](https://help.x.com/en/resources/recommender-systems/search-recommendations)
- [X: Under the Hood transparency information](https://help.x.com/en/business-and-advertising/brand-safety/products-that-protect)
- [Sorsa: Shadowban checker API interface](https://api.sorsa.io/playground/shadowban-check)

Independent project. Not affiliated with, sponsored by, or endorsed by X Corp. or Sorsa.
