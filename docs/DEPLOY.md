# Deploying CampusFlow

The **backend** and **frontend** are deployed as two separate services, plus a **free MongoDB Atlas** database. The Python analysis runs from your laptop against the same database.

```
Phones ──HTTPS──► campusflow-web (static React site) ──HTTPS + CORS──► campusflow-api (Express) ──► MongoDB Atlas
                                                                                                     ▲
Your laptop: npm run analyze ─────────────────────────────────────────────────────────────────────────┘
```

| Service | What | Knows about the other through |
|---|---|---|
| `campusflow-api` | Node/Express API on Render | `CORS_ORIGINS` = the frontend's host. Only that site may call it from a browser. |
| `campusflow-web` | Static build of `client/` on Render (or Vercel) | `VITE_API_HOST` / `VITE_API_BASE_URL` = the API's address, baked in at build time |

Both are wired automatically by [render.yaml](../render.yaml).

## 1. Database: MongoDB Atlas

1. Create a **free M0** cluster (AWS, **Mumbai**).
2. **Database Access**: add a user with a strong generated password.
3. **Network Access**: **Allow access from anywhere** (`0.0.0.0/0`). Render's free tier has no fixed IP.
4. **Connect → Drivers**: copy the string, replace `<db_password>` (remove the `<` `>` too), and add the database name before the `?`:
   ```
   mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/campusflow?retryWrites=true&w=majority
   ```
5. Test it from your laptop: put it in `server/.env` as `MONGODB_URI=…` (git-ignored), then run `npm run db:check -w server`.

## 2. Deploy both services on Render (one blueprint)

1. Open **https://render.com/deploy?repo=https://github.com/vectobest/campusflow** and sign in with GitHub.
2. Render shows two services, **campusflow-api** and **campusflow-web**. Fill in:
   | Key | Value |
   |---|---|
   | `MONGODB_URI` | the Atlas string from step 1 |
   | `STUDY_CONTACT` | your name and email (shown on the consent form) |
   | `ETHICS_APPROVAL_REF` | your approval reference, or "pending" |
3. **Apply**. Render builds the API, then the website with the API's address built in. You get two HTTPS links:
   - `https://campusflow-web-xxxx.onrender.com`: **share this one** with students.
   - `https://campusflow-api-xxxx.onrender.com/api/v1/health`: should show `"db":"connected"`.

Every push to `main` redeploys both. GitHub Actions runs all tests first.

### Alternative: frontend on Vercel

Deploy only `campusflow-api` on Render. Then on Vercel, import the repo with **Root Directory = `client`** ([client/vercel.json](../client/vercel.json) handles routing and headers). Set the environment variable `VITE_API_BASE_URL=https://campusflow-api-xxxx.onrender.com/api/v1`. Finally, set the API's `CORS_ORIGINS` on Render to your Vercel URL (e.g. `https://campusflow.vercel.app`).

**Free-tier note:** the API sleeps after 15 minutes idle, and the first request then takes about a minute. Open the site once before a session or demo. Points recorded meanwhile wait on the phone and upload automatically.

## Optional: Sign in with Google

1. In **Google Cloud Console**, open **APIs & Services → OAuth consent screen**. Choose *External*, enter the app name **CampusFlow** and your support email, then publish.
2. Open **APIs & Services → Credentials → Create credentials → OAuth client ID**. Choose **Web application**.
3. Under **Authorized JavaScript origins**, add the website's address, e.g. `https://campusflow-web-ten.vercel.app`, and `http://localhost:5173` for development. No redirect URI is needed: the popup flow returns an ID token directly.
4. Copy the **Client ID** (`….apps.googleusercontent.com`). It is public, not a secret, and no client secret is used.
5. On the API service, set `GOOGLE_CLIENT_ID` to that value. Optionally set `GOOGLE_ALLOWED_DOMAINS=nitrr.ac.in` to accept only institute accounts. Then redeploy the API. The website reads the client ID from `/api/v1/config/auth`, so it does not need rebuilding.

## 3. Make yourself a researcher

Register on the live site, then from your laptop:
```bash
MONGODB_URI="mongodb+srv://…/campusflow?…" npm run set-role -w server -- you@example.com researcher
```

## 4. Analyse collected data

```bash
MONGODB_URI="mongodb+srv://…/campusflow?…" npm run analyze -- \
  --dataset nitrr-campus-collected --places analytics/places/nitrr_places.geojson
```
The result is stored in Atlas and appears immediately on the live **Analytics** page.

Optional demo data (clearly labelled synthetic on the dashboard):
```bash
MONGODB_URI="…" npm run seed
MONGODB_URI="…" npm run analyze -- --dataset synthetic-dev --places data/synthetic/synthetic_places.geojson
```
(`npm run seed -- --csv` also writes the places file used above.)

## Security checklist before real collection

- [ ] `STUDY_CONTACT` and `ETHICS_APPROVAL_REF` set (the consent form shows TODO until then).
- [ ] Atlas password is strong and not committed anywhere. `.env` files are git-ignored.
- [ ] Optional `STUDY_AREA_BBOX` set from a verified campus boundary, so off-campus points are never stored.
- [ ] Share the Render URL only with participants. Only researchers can see analytics.
