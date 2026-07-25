# AgriLink AI 2.0 — System Architecture

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│                                   CLIENT LAYER                                         │
│                                                                                          │
│  ┌────────────────────┐   ┌────────────────────┐   ┌────────────────────┐            │
│  │  FARMER MOBILE APP  │   │  BUYER WEB PORTAL   │   │  ADMIN WEB PANEL    │            │
│  │  (Flutter / RN)     │   │  (React + Tailwind) │   │  (React + Tailwind) │            │
│  │----------------------│   │----------------------│   │----------------------│            │
│  │ • Crop Navigator     │   │ • Marketplace Browse │   │ • System Config     │            │
│  │ • Timeline Checklist │   │ • Order Placement    │   │ • Metrics Dashboard │            │
│  │ • Weather Alerts     │   │ • Reject/QA Flow     │   │ • Ad Scheduler      │            │
│  │ • Disease Scanner    │   │ • Secondary Market    │   │ • Transaction Logs  │            │
│  │ • Truck Requests     │   │   (Flash Sale) View   │   │ • User Moderation   │            │
│  │ • Driver Mode Toggle │   │                       │   │                     │            │
│  │ • Chatbot (Si/Ta/En) │   │                       │   │                     │            │
│  │                       │   │                       │   │                     │            │
│  │ [SQLite/Hive Local DB]│   │                       │   │                     │            │
│  │  ↓ Background Sync    │   │                       │   │                     │            │
│  └──────────┬────────────┘   └──────────┬────────────┘   └──────────┬──────────┘            │
│             │  HTTPS/REST + WebSocket    │  HTTPS/REST               │  HTTPS/REST            │
└─────────────┼────────────────────────────┼────────────────────────────┼───────────────────────┘
              │                            │                            │
              ▼                            ▼                            ▼
┌──────────────────────────────────────────────────────────────────────────────────────┐
│                          API GATEWAY / AUTH MIDDLEWARE                                 │
│           (JWT auth, role-based access: farmer | driver | buyer | admin)               │
└───────────────────────────────────────┬────────────────────────────────────────────────┘
                                         │
                                         ▼
┌──────────────────────────────────────────────────────────────────────────────────────┐
│                        BACKEND CORE (Node.js + Express)                                │
│                                                                                          │
│  ┌───────────────┐ ┌──────────────────┐ ┌───────────────────┐ ┌────────────────────┐ │
│  │ /auth         │ │ /timelines        │ │ /marketplace       │ │ /logistics          │ │
│  │ /users        │ │  ↳ sync-queue     │ │  ↳ listings         │ │  ↳ lorry-tracking   │ │
│  │               │ │  ↳ crop-recommend │ │  ↳ reject-mitigate  │ │  ↳ cargo-match      │ │
│  └───────────────┘ └──────────────────┘ └───────────────────┘ └────────────────────┘ │
│  ┌───────────────┐ ┌──────────────────┐ ┌───────────────────┐ ┌────────────────────┐ │
│  │ /price-predict│ │ /crowdfunding     │ │ /disease            │ │ /ads / /admin       │ │
│  │  ↳ aggregator │ │  ↳ pledges         │ │  ↳ outbreak-radar   │ │  ↳ scheduler        │ │
│  └───────────────┘ └──────────────────┘ └───────────────────┘ └────────────────────┘ │
│                                                                                          │
│         │                    │                     │                    │              │
└─────────┼────────────────────┼─────────────────────┼────────────────────┼──────────────┘
          ▼                    ▼                     ▼                    ▼
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│  MongoDB Atlas     │  │ External Weather  │  │ CV Disease Model  │  │ Payment / Wallet  │
│  (Primary Store)   │  │ API (Open-Meteo)  │  │ (TensorFlow/ONNX  │  │ Gateway (PayHere / │
│                     │  │                    │  │  served via       │  │ Stripe sandbox)    │
│  Collections:       │  │                    │  │  FastAPI micro-   │  │                    │
│  • users            │  │                    │  │  service)         │  │                    │
│  • cultivation_     │  │                    │  │                   │  │                    │
│    timelines         │  │                    │  │                   │  │                    │
│  • marketplace_      │  └──────────────────┘  └──────────────────┘  └──────────────────┘
│    listings           │
│  • lorry_fleet_       │
│    tracking            │
│  • disease_logs        │
│  • advertisements      │
└──────────────────┘

DATA FLOW SUMMARY
------------------
1. Farmer logs cultivation activity offline on mobile → cached in local SQLite/Hive with
   syncStatus="pending" → on network detect, background job pushes queued docs to
   /timelines/sync-queue → server upserts into cultivation_timelines, resolves conflicts
   by lastModified timestamp (last-write-wins per field group).

2. Farmer lists harvest → POST /marketplace/listings (tier="primary") → Buyer views on
   Web Portal → Buyer can PATCH /marketplace/listings/:id/reject → controller runs
   reject-mitigation logic → listing auto re-tiers to "secondary", price markdown applied,
   visibility flag switches to factories/restaurants/compost-hub buyer segment.

3. Price prediction: cron/aggregator job pulls last-90-day price history + live weather
   flags + regional shortage counts + Sri Lankan calendar events → weighted scoring model
   in utils/pricePredictionEngine.js → cached prediction served via /price-predict/:crop.

4. Disease scan: mobile uploads leaf photo → FastAPI CV microservice returns
   {disease, confidence} → server writes to disease_logs with GeoJSON location →
   2dsphere geospatial query clusters recent logs within radius → if cluster count
   exceeds threshold, outbreak alert pushed to all farmers in that geofence.
```
