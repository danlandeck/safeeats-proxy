# SafeEats Proxy API

A Vercel serverless proxy that fetches food inspection data from government APIs
and enforces strict city isolation before returning results to the SafeEats frontend.

## Why this exists

Base44 (where SafeEats is hosted) cannot make direct outbound calls to government
Socrata data portals. This proxy runs on Vercel (free tier) and acts as the bridge.

## How it works

- One endpoint: `GET /api/search?city=seattle&q=starbucks`
- Only the matching city's API is ever called — never multiple at once
- Results are normalized to a common schema across all cities
- A hard geographic filter drops any result that doesn't belong to the selected city
- Results are deduplicated (inspection data has one row per violation, not per restaurant)

## Supported cities

| city param   | Source API |
|--------------|------------|
| `seattle`    | data.kingcounty.gov |
| `nyc`        | data.cityofnewyork.us |
| `chicago`    | data.cityofchicago.org |
| `austin`     | data.austintexas.gov |
| `sf`         | data.sfgov.org |
| `la`         | data.lacounty.gov |
| `montgomery` | data.montgomerycountymd.gov |

## Response format

```json
{
  "city": "seattle",
  "query": "starbucks",
  "count": 12,
  "results": [
    {
      "id": "PR0012345",
      "name": "STARBUCKS #1234",
      "address": "1912 PIKE PL",
      "city": "SEATTLE",
      "zip": "98101",
      "phone": "(206) 555-1234",
      "lat": 47.6097,
      "lng": -122.3331,
      "inspection_date": "2025-08-15",
      "inspection_score": 5,
      "inspection_result": "Satisfactory",
      "grade": "",
      "description": "Seating 13-50 - Risk Category III",
      "violation_description": "",
      "violation_points": 0
    }
  ]
}
```

## Deployment (one-time setup)

### 1. Install Vercel CLI
```bash
npm install -g vercel
```

### 2. Deploy
```bash
cd safeeats-proxy
vercel
```
- When prompted, create a new project named `safeeats-proxy`
- Follow the prompts (all defaults are fine)
- Vercel will give you a URL like: `https://safeeats-proxy.vercel.app`

### 3. (Optional but recommended) Add a Socrata App Token
Register for a free app token at https://data.cityofchicago.org/profile/app_tokens
to get higher rate limits across all Socrata APIs.

In Vercel dashboard → Project → Settings → Environment Variables:
```
SOCRATA_APP_TOKEN = your_token_here
```

### 4. Update SafeEats frontend in Base44
Replace all direct government API calls in the Base44 app with calls to:
```
https://safeeats-proxy.vercel.app/api/search?city=seattle&q=SEARCH_TERM
https://safeeats-proxy.vercel.app/api/search?city=nyc&q=SEARCH_TERM
https://safeeats-proxy.vercel.app/api/search?city=chicago&q=SEARCH_TERM
https://safeeats-proxy.vercel.app/api/search?city=austin&q=SEARCH_TERM
https://safeeats-proxy.vercel.app/api/search?city=sf&q=SEARCH_TERM
https://safeeats-proxy.vercel.app/api/search?city=la&q=SEARCH_TERM
https://safeeats-proxy.vercel.app/api/search?city=montgomery&q=SEARCH_TERM
```

## Cost
Vercel free tier includes 100GB bandwidth and 100,000 function invocations/month.
SafeEats at current scale (500 users) will use a tiny fraction of this.
