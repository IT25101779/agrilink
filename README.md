# AgriLink AI 2.0 — Backend Core (Step 1)

## What's in this step
- `ARCHITECTURE.md` — full system diagram (all 3 frontends + backend + DB + AI engines)
- `models/` — Mongoose schemas for all 6 collections
- `controllers/` + `routes/` — working Marketplace API (with auto reject-mitigation) and Price Prediction API
- `server.js` — runnable Express app

## Setup (do this first, before touching any code)

1. **Install Node.js** (v18+) from nodejs.org if you don't have it.
2. **Create a free MongoDB Atlas cluster**: go to mongodb.com/cloud/atlas, sign up, create a free (M0) cluster, create a database user, and copy your connection string.
3. Open a terminal in this folder and run:
   ```bash
   npm install
   ```
4. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
   Then paste your MongoDB connection string into `MONGO_URI` inside `.env`.
5. Start the server:
   ```bash
   npm run dev
   ```
   You should see `AgriLink AI 2.0 backend listening on port 5000`.
6. Test it's alive by visiting `http://localhost:5000/api/health` in your browser.

## Try the two working features right now

## Get your free Kindwise Crop.health API key (for the Disease Scanner)

1. Go to **[admin.kindwise.com](https://admin.kindwise.com/)** and sign up
2. Once logged in, request/copy your API key from the dashboard
3. Paste it into your `.env` file:
   ```
   KINDWISE_API_KEY=your_actual_key_here
   ```
4. Restart your server (`Ctrl+C` then `npm run dev`)

They offer free trial credits which is plenty for hackathon demo purposes.

**Test the disease scan endpoint** (replace `<BASE64_IMAGE>` with an actual base64-encoded leaf photo — easiest to test this one from the mobile app's Disease Scanner screen instead of curl):
```bash
curl -X POST http://localhost:5000/api/disease/scan \
  -H "Content-Type: application/json" \
  -d '{"farmer":"665f1a2b3c4d5e6f7a8b9c0d","cropType":"tomato","imageBase64":"data:image/jpeg;base64,<BASE64_IMAGE>","latitude":7.29,"longitude":80.63}'
```

## Try the marketplace + price prediction features right now

**Create a marketplace listing:**
```bash
curl -X POST http://localhost:5000/api/marketplace/listings \
  -H "Content-Type: application/json" \
  -d '{"farmer":"665f1a2b3c4d5e6f7a8b9c0d","cropType":"tomato","quantityKg":500,"pricePerKg":120,"harvestDate":"2026-09-01"}'
```

**Reject it and watch it auto-move to the secondary market:**
```bash
curl -X PATCH http://localhost:5000/api/marketplace/listings/<LISTING_ID>/reject \
  -H "Content-Type: application/json" \
  -d '{"rejectedBy":"665f1a2b3c4d5e6f7a8b9c0e","reason":"Minor bruising on batch","defectType":"bruising"}'
```
Check the response — `tier` is now `"secondary"`, `currentPricePerKg` is discounted, and `targetBuyerSegment` now shows factories/restaurants/compost hubs.

**Get a price prediction:**
```bash
curl "http://localhost:5000/api/price-predict/tomato?heavyRainRiskPercent=60"
```

## What's next (say the word and we build it)
1. Farmer mobile app screens (Flutter) — starting with the Crop Navigator + offline timeline
2. Buyer web portal (React + Tailwind) — marketplace browse/order UI
3. Admin dashboard — metrics + ad scheduler
4. Disease detection CV microservice + chatbot integration
5. Auth (JWT) + user registration endpoints (needed before the above will fully work)

**My advice:** build in this order — Auth → Farmer mobile MVP (Navigator + Marketplace listing) → Buyer portal → polish/demo video. Skip logistics tracking and crowdfunding for the actual build; keep them as "Phase 2 roadmap" slides in your pitch deck. That's the version of this project one beginner solo developer can actually finish and demo confidently.

## Crowdfunding Engine (Step 7)
`/api/crowdfunding` powers the micro-investment feature: farmers request funding for an active timeline (`POST /campaigns`), investors browse and pledge (`GET /campaigns`, `POST /campaigns/:id/pledge`), and once a campaign is fully funded and the harvest sells, the farmer/admin triggers `PATCH /campaigns/:id/repay`, which marks all pledges repaid and bumps the farmer's `farmerProfile.creditScore` — this is the seed of the "alternative credit scoring" feature from your original spec.

**Important scope note:** this simulates the funding ledger entirely within MongoDB — no real payment gateway is wired in. Crowdfunding/lending is a regulated financial activity in most jurisdictions including Sri Lanka, so treat this as a working prototype of the *mechanic*, not a launch-ready payments feature. Say so plainly if a judge asks — it's a strength, not a weakness, to know exactly where the prototype boundary is.

## Multilingual AI Chatbot (Step 8)
`/api/chat` powers the 24/7 assistant. It's built on the real Anthropic API (Claude) — the same model family this coding session runs on — and injects the farmer's active crop/day/upcoming milestones into the system prompt so answers are genuinely contextual, not generic. Responds in English, Sinhala, or Tamil based on the `language` the app sends.

**Setup:**
1. Get an API key at **console.anthropic.com** (Anthropic's developer console — separate from claude.ai)
2. Add to your `.env`:
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   ```
3. Restart your server

**Test it:**
```bash
curl -X POST http://localhost:5000/api/chat/message \
  -H "Content-Type: application/json" \
  -d '{"farmer":"665f1a2b3c4d5e6f7a8b9c0d","message":"When should I water my tomatoes?","language":"en"}'
```

## Forgot Password (Step 9)
`/api/auth/forgot-password` and `/api/auth/reset-password` add a real 6-digit OTP email flow — works for any role (farmer, driver, buyer, admin) since they all share the same User model.

**Setup — get a Gmail App Password (free, 2 minutes):**
1. Go to your Google Account → Security → turn on **2-Step Verification** if not already on
2. Go to **myaccount.google.com/apppasswords**
3. Create an app password (name it "AgriLink")
4. Copy the 16-character password it gives you
5. Add to your `.env`:
   ```
   EMAIL_USER=youraddress@gmail.com
   EMAIL_APP_PASSWORD=the16characterpassword
   ```
6. Restart your server

**No email set up yet?** The endpoint still works — it just logs the OTP code to your backend terminal instead of emailing it (look for `[DEV FALLBACK]` in the console), so you're never blocked from testing.

## Smart Reminders (Step 13)
`/api/reminders` is the reminder engine your Navigator/Timeline system was missing: it cross-references **real weather data** (Open-Meteo, free, no API key needed), **regional disease outbreak data** (from the Disease Scanner you already built), and **the timeline's own schedule** to generate contextual reminders — "rain tomorrow, fertilize today", "blight reported nearby, send a photo", "harvest approaching", "overdue task". Calling `/generate` repeatedly is safe — a dedupe key prevents the same reminder firing twice.

**Scope note:** this generates reminders and serves them to the app (in-app notification center + local device notifications while the app is running). True background push notifications that wake a fully closed app need Firebase Cloud Messaging — a heavier native setup (Firebase project, google-services.json). That's a clean "Phase 2" item, not something to rush into a hackathon build.

## Nearby Suppliers & Equipment Rentals (Step 16)
`/api/suppliers` — the "recommends nearby verified input stores" + "rental companies for tractors/machines" feature from your original spec. Geo-indexed, filterable by type (seed_store, fertilizer_store, tool_store, equipment_rental).

**To make this demoable immediately** (instead of manually adding data through Postman), run the seed script once your `.env`/MongoDB is set up:
```bash
node scripts/seedSuppliers.js
```
This adds 10 realistic sample suppliers/rental companies across Kurunegala, Matale, Kandy, Anuradhapura, Galle, Colombo, Matara, Jaffna, Ratnapura, and Badulla — enough spread that testing from most Sri Lankan coordinates will return real nearby results.

Admin management (create/edit/delete suppliers through the Admin Command Center UI) isn't built yet — for now, add/edit real suppliers by extending the seed script or via direct API calls with an admin JWT. That's a natural next step if you want it.
