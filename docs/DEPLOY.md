# Deploying CampusFlow

Production is **one Render web service** (the Node API that also serves the built web app over HTTPS) plus a **free MongoDB Atlas** database. The Python analysis runs from your laptop against the same database.

```
Phones ──HTTPS──► Render: campusflow (Express API + web app) ──► MongoDB Atlas (Mumbai)
                                                                    ▲
Your laptop: npm run analyze  ──────────────────────────────────────┘
```

Both services have free tiers. You need a GitHub account (repository pushed), a MongoDB Atlas account and a Render account.

## 1. Database: MongoDB Atlas (≈5 min)

1. Sign up at https://www.mongodb.com/cloud/atlas and create a **free M0** cluster. Provider AWS, region **Mumbai (ap-south-1)**.
2. **Database Access** → Add user, e.g. `campusflow`, with a generated password. Role: *Read and write to any database*.
3. **Network Access** → Add IP address → **Allow access from anywhere** (`0.0.0.0/0`). Render's free tier has no fixed IP; the strong password protects the database.
4. **Connect → Drivers** → copy the connection string and add the database name `campusflow` before the `?`:
   ```
   mongodb+srv://campusflow:<password>@cluster0.xxxxx.mongodb.net/campusflow?retryWrites=true&w=majority
   ```

## 2. App: Render (≈5 min)

1. Sign up at https://render.com with **"Sign in with GitHub"**.
2. Open **https://render.com/deploy?repo=https://github.com/vectobest/campusflow** (or the README's *Deploy to Render* button, or **New → Blueprint** → the repository). Render reads [render.yaml](../render.yaml).
3. Fill in the values it asks for:
   | Key | Value |
   |---|---|
   | `MONGODB_URI` | the Atlas string from step 1 |
   | `STUDY_CONTACT` | your name and email (shown on the consent form) |
   | `ETHICS_APPROVAL_REF` | your approval reference, or "pending" |
   `JWT_SECRET` is generated automatically.
4. **Apply**. The first build takes a few minutes. Your app is then live at `https://campusflow-xxxx.onrender.com`, with HTTPS already on, so phone GPS works.
5. Check `https://<your-app>.onrender.com/api/v1/health` returns `"db":"connected"`.

Every `git push` to `main` redeploys automatically. GitHub Actions ([ci.yml](../.github/workflows/ci.yml)) runs all tests on each push.

**Free-tier note:** the service sleeps after 15 minutes without traffic, and the first visit afterwards takes about a minute to wake. Before a collection session or a demo, open the site once. Points collected while the server is waking are queued on the phone and uploaded once it responds.

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
