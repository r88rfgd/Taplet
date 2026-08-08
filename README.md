# Taplet 🌿📍
**Hyperlocal allergy-risk intelligence, built from street-level imagery, live weather, air quality, and biodiversity data.**

Taplet answers one question with real evidence instead of a generic pollen-count widget: *"Standing right here, right now, what am I actually going to react to?"*

---

## The Problem

Pollen/allergy apps give city-wide averages pulled from a single weather station miles away. They don't know that there's a row of birch trees outside your hostel block, or that the grass median you walk past every morning is in bloom. Allergy sufferers end up either over-medicating "just in case" or getting blindsided by triggers a generic forecast never mentioned.
Mild cold or cough blamed on ice creams,
when it was your surroundings, more details - [Problem.pdf](https://github.com/user-attachments/files/30835967/Problem.pdf)

## The Solution

Taplet pins an exact latitude/longitude and builds a **grounded, on-site risk assessment** by combining:

1. **What's actually growing there** — real street-level photos analyzed by a vision model
2. **What's biologically present** — verified species records for the area
3. **What the air and sky are doing right now** — live weather, UV, and air-quality data
4. **A reasoning pass** that fuses all three into one prioritized, plain-language risk report — plus a personal match against the allergies the user has told the app about

All of this is exposed through a Flask API and consumed by a React Native (Expo) mobile app.

---

## How It Works (Pipeline)

```
                              ┌───────────────────────────────┐
                              │   User picks / shares a         │
                              │   location in the mobile app    │
                              └───────────────┬─────────────────┘
                                              │  lat, lon, radius
                                              ▼
                              ┌───────────────────────────────┐
                              │  Flask API: /allergy-assessment │
                              └───────────────┬─────────────────┘
                                              │
                     ┌────────────────────────┼────────────────────────┐
                     │  Cache check: is there already a saved            │
                     │  assessment within ~100m of this point?           │
                     └────────┬───────────────────────────────┬─────────┘
                       YES ── │                                │ ── NO
                              ▼                                ▼
                 ┌─────────────────────┐        ┌───────────────────────────────────┐
                 │ Return cached result │        │ Run the full pipeline, in parallel: │
                 │ instantly            │        └───────────────────────────────────┘
                 └─────────────────────┘                        │
                              ┌────────────────────┬─────────────┴────────────┬────────────────────┐
                              ▼                     ▼                         ▼                     │
                   ┌───────────────────┐ ┌────────────────────┐ ┌──────────────────────┐            │
                   │ GBIF               │ │ Open-Meteo          │ │ Mapillary              │           │
                   │ (biodiversity API) │ │ (weather + AQI API) │ │ (street imagery API)  │           │
                   │                    │ │                     │ │                        │           │
                   │ → local plant /    │ │ → temp, humidity,   │ │ → nearby street-level  │           │
                   │   species records  │ │   wind, UV, pollen, │ │   photos within radius │           │
                   │   near the point   │ │   PM2.5 / AQI       │ │                        │           │
                   └─────────┬──────────┘ └──────────┬──────────┘ └───────────┬────────────┘          │
                              │                       │                       ▼                        │
                              │                       │           ┌───────────────────────┐            │
                              │                       │           │ Blur filter (OpenCV)    │            │
                              │                       │           │ keeps only sharp photos │            │
                              │                       │           └───────────┬───────────┘            │
                              │                       │                       ▼                        │
                              │                       │           ┌───────────────────────────┐        │
                              │                       └──────────▶│ Vision model (qwen2.5-vl)   │        │
                              │                                   │ looks at each clear photo,   │        │
                              │                                   │ using GBIF + weather as       │        │
                              │                                   │ context, and flags visible    │        │
                              │                                   │ trees / grass / mold / weeds  │        │
                              │                                   └───────────────┬───────────────┘        │
                              │                                                   │                        │
                              └───────────────────────┬───────────────────────────┘                        │
                                                        ▼                                                  │
                                          ┌─────────────────────────────────┐                              │
                                          │ Reasoning model (gemma)          │◀─────────────────────────────┘
                                          │ fuses GBIF + weather/AQI +       │
                                          │ vision findings into:            │
                                          │  • overall risk score & level    │
                                          │  • hourly + daily forecast       │
                                          │  • top trigger plants            │
                                          │  • time-based recommendations    │
                                          └───────────────────┬───────────────┘
                                                              ▼
                                          ┌─────────────────────────────────┐
                                          │ Save to persistent cache          │
                                          │ (keyed by lat/lon/radius)         │
                                          └───────────────────┬───────────────┘
                                                              ▼
                                          ┌─────────────────────────────────┐
                                          │ Returned to the app as one JSON   │
                                          │ "master assessment"               │
                                          └───────────────────┬───────────────┘
                                                              ▼
                              ┌─────────────────────────────────────────────────────┐
                              │  Mobile app renders:                                  │
                              │   • risk score + hourly/daily timeline                │
                              │   • scan map — pins colored by severity, tap for photo │
                              │   • top trigger plants + recommendations              │
                              │   • personal match against saved allergies (grep-style│
                              │     match across the whole assessment, no extra call) │
                              └─────────────────────────────────────────────────────┘
```

### Supporting flows (same backend, independent of location)

```
Food photo ──▶ Vision model ──▶ estimated calories + allergy/health risk flags ──▶ saved to Food Log
Medicine name ──▶ Tavily web search ──▶ price comparison across pharmacies (India)
Manual health metrics (BP, sugar, etc.) ──▶ stored and tracked over time
Health documents (PDF/image) ──▶ stored, searchable by name
```

---

## Key Features

- **Location-grounded risk scoring** — not a city-wide average, but an assessment built from photos and records near the exact point
- **Context-aware vision analysis** — the photo model is fed real GBIF species data and live weather *before* it judges risk, so it isn't guessing blind
- **Interactive scan map** — severity-colored pins, tap any pin to see the photo and reasoning behind it
- **Personal allergy matching** — deterministic keyword/category matching of the user's saved allergies against every layer of the assessment (visual, botanical, weather) with zero extra model calls
- **Hourly + multi-day risk forecast** with time-of-day recommendations
- **Geospatial caching** — repeat queries within ~100m return instantly instead of re-running the full pipeline
- **Food logging** with AI-estimated calories and risk flags from a single photo
- **Medicine price lookup** via live web search, cleaned down to just price + pharmacy
- **Personal health record** — medicines, documents, and manual health metrics, all stored locally via SQLite

## Features Not Yet Implemented / In Progress
- Real-time physiological data syncing from wearable hardware.
- Offline / low-connectivity mode
- Multi-user accounts and sync across devices

## Known Limitations

- Assessment quality depends on Mapillary photo coverage — sparsely mapped areas fall back to weather + biodiversity data only
- Vision/reasoning models currently run locally via Ollama, so inference speed depends on the host machine

## Tech Stack

**Backend:** Python, Flask, SQLite, OpenCV, Ollama (qwen2.5-vl for vision, gemma4:e4b for reasoning), Tavily API
**Data sources:** Mapillary Graph API, GBIF Occurrence API, Open-Meteo Forecast + Air Quality API
**Frontend:** React Native (Expo)

---

## Testing Location

Development and demo testing included coordinates around the Chandigarh University campus (host institution for this hackathon), using Mapillary's crowdsourced street-level coverage in that area alongside live weather and biodiversity data for the same point.
To test its lat - 30.764818084454873 log - 76.57405248850264
cache folder - mapillary_30.764818084454873_76.57405248850264_100m
For this project Chandigarh University campus street view was captured by us, and we are the FIRST one to do it 
all the captures can be found here
https://www.mapillary.com/app/user/cloot?lat=30.768409507393514&lng=76.57478704289224&z=14.893745256649888

## Demo

https://github.com/user-attachments/assets/4ff31cd7-31d3-4c47-8229-deb2fbbe5c79

# Setup & Installation

This guide covers the setup required to run the TAPLET backend, local AI models, and React Native / Expo frontend.
Apk is in the Repo & Releases
## 1. Prerequisites

Make sure the following are installed:

- **Python 3.9+**
- **Node.js & npm**
- **Ollama** — running locally or on a reachable network host

## 2. API Keys Required

| Service | Setup Instructions |
|---|---|
| **Mapillary** | 1. Log in to the [Mapillary Developer Dashboard](https://www.mapillary.com/dashboard/developers).<br>2. Register a new application.<br>3. Copy the **Client Token** (usually starts with `MLY`). |
| **Tavily** | 1. Log in to the [Tavily Dashboard](https://tavily.com/).<br>2. Generate and copy your API key (usually starts with `tvly-`). |

> **Security:** Never commit API keys or your `.env` file to Git.

## 3. Backend (Flask) Setup

### 3.1 Install Python dependencies

Navigate to the backend directory and run:

```bash
pip install Flask flask-cors python-dotenv requests opencv-python ollama werkzeug
```

### 3.2 Install the required Ollama models

Pull the AI models used by the reasoning and vision pipelines:

```bash
ollama pull qwen2.5vl:7b
ollama pull gemma4:e4b
```

Make sure Ollama is running before starting the backend.

### 3.3 Configure environment variables

Create a `.env` file in the root backend directory:

```env
TAVILY_KEY=your_tavily_key_here
OLLAMA_HOST=http://127.0.0.1:11434
MAPILLARY_TOKEN=your_mapillary_token_here
FLASK_PORT=8000
DB_PATH=user_data/taplet.db
```

If Ollama is running on another machine, replace `127.0.0.1` with the reachable host IP:

```env
OLLAMA_HOST=http://YOUR_HOST_IP:11434
```

> **Database:** The SQLite database is automatically created at `DB_PATH` on the first run. The application can also migrate legacy JSON data if supported by the current backend configuration.

### 3.4 Start the Flask API

From the backend directory:

```bash
python main.py
```

The API will run on the configured Flask port, normally:

```text
http://localhost:8000
```

## 4. Frontend (React Native / Expo) Setup

### 4.1 Install dependencies

Navigate to the mobile application directory:

```bash
npm install
```

### 4.2 Start Expo

Run:

```bash
npx expo start
```

Expo will display a development server and provide options for running the application on a physical device, emulator, or simulator.

## 5. Recommended Startup Order

For a clean local development setup, start the services in this order:

### Terminal 1 — Ollama

```bash
ollama serve
```

If Ollama is already running as a background service, this step may not be necessary.

### Terminal 2 — Flask Backend

```bash
python main.py
```

### Terminal 3 — Expo Frontend

```bash
cd Taplet
npm install
npm run ios
```



## Team

**Taplet** T245

---

## Bounties

### 🔹 Core Bounties (4)

1. **Bug Fix & Stability**
   Resolve minor bugs and improve system stability for smoother user experience.

2. **UI Enhancements**
   Refine the interface with cleaner layouts and responsive design.

3. **Documentation Update**
   Write clear setup guides, usage instructions, and API references.

4. **Basic Testing Suite**
   Implement unit tests to validate core functionality and prevent regressions.

### 🔹 Advanced Bounties (3)

5. **Data Integration Layer**
   Connect project with live datasets or APIs for dynamic updates.

6. **Performance Optimization**
   Improve speed and efficiency of algorithms and backend processes.

7. **Feature Expansion**
   Add one mid‑level feature (e.g., dashboard analytics, notifications, or role-based access).

### 🔹 Elite Bounties (3)

8. **AI/ML Enhancement**
   Integrate advanced AI models for intelligent automation or predictions.

9. **Scalability & Deployment**
   Prepare the system for large‑scale use with cloud deployment and load balancing.

10. **Security & Compliance**
   Implement advanced security protocols, encryption, and compliance checks.

---

## Implementation Tracking List

- [x] 1. **Bug Fix & Stability**
- [x] Resolve minor bugs and improve system stability for smoother user experience.
- [x] `Taplet/src/screens/SecondaryScreens.js` — relevant section starts around line 117


————————————————————————————————————

- [x] 2. **UI Enhancements**
- [x] Refine the interface with cleaner layouts and responsive design.
- [x] Line 143: PDF "open" button now shows only the 📂 icon (no text)
- [x] Line 133: Bounty comment — Documents upload screen: PDFs now open on tap (whole card calls `Linking.openURL`)
- [x] Line 62-67: Bounty comment + Export button now shows only the 🔗 share icon (no text)
- [x] `Taplet/src/screens/HomeScreen.js`
- [x] Line 56-58: Bounty comment + Open Map button now shows only the 📍 pin icon (no text)

————————————————————————————————————

- [x] 3. **Documentation Update**
- [x] Write clear setup guides, usage instructions, and API references.
- [x] README.md file changes at the end

————————————————————————————————————

- [x] 4. **Basic Testing Suite**
- [x] Implement unit tests to validate core functionality and prevent regressions.
- [x] Added a separate `test-core.py` file

————————————————————————————————————

- [x] 5. **Data Integration Layer**
- [x] Connect project with live datasets or APIs for dynamic updates.
- [x] Line 396 `main.py`, comments on top of `mapillary_client.py`, `gbif_client.py`, `open_meteo_client.py`

————————————————————————————————————

- [x] 6. **Performance Optimization**
- [x] Improve speed and efficiency of algorithms and backend processes.
- [x] Line 10, 397 `main.py`

————————————————————————————————————

- [x] 7. **Feature Expansion**
- [x] Add one mid‑level feature (e.g., dashboard analytics, notifications, or role-based access).
- [x] `App.js`
- [x] We already had dashboard analytics
- [x] Line 11 — import of notification/PDF/share libs
- [x] Line 103 — notification config + permission effect
- [x] Line 133 — matched-allergy push notification effect
- [x] Line 184 — `shareScanPdf` PDF export/share function

————————————————————————————————————

- [x] 8. **AI/ML Enhancement**
- [x] Integrate advanced AI models for intelligent automation or predictions.
- [x] Line 33 `main.py`

————————————————————————————————————

- [x] 9. **Scalability & Deployment**
- [x] Prepare the system for large‑scale use with cloud deployment and load balancing.
- [x] main.py Line number 77
- [x] `Dockerfile` added to the project to support containerized deployment

————————————————————————————————————

- [x] 10. **Security & Compliance**
- [x] Implement advanced security protocols, encryption, and compliance checks.
- [x] main.py line number 58,65
