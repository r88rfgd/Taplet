# app.py
import json
import os
import glob
import math
import time
import re
from datetime import datetime
from typing import Optional, Dict, Tuple, Any

from flask import Flask, request, jsonify, send_from_directory, abort
from flask_cors import CORS
from ollama import chat
import uuid
from werkzeug.utils import secure_filename
from dotenv import load_dotenv

# Load secrets / configuration from .env (never hardcode these in source)
load_dotenv()

from mapillary_client import MapillaryPhotosFinder
from open_meteo_client import get_environmental_data
from gbif_client import get_local_plant_species
import db

# --- Configuration (all values sourced from environment) ---
TAVILY_KEY = os.getenv("TAVILY_KEY", "")
MAPILLARY_TOKEN = os.getenv("MAPILLARY_TOKEN", "")
OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")
os.environ["OLLAMA_HOST"] = OLLAMA_HOST
VISION_MODEL = "qwen2.5vl:7b"   # image-based tasks (street-level vision analysis)
REASON_MODEL = "gemma4:e4b"     # text reasoning / structured aggregation
CACHE_DISTANCE_THRESHOLD_METERS = 100.0  # Treat queries within 100 meters as identical location
CACHE_DIR = "assessment_cache" # Persistent folder for saving assessments

try:
    from tavily import TavilyClient
    tavily_client = TavilyClient(TAVILY_KEY) if TAVILY_KEY else None
except Exception as e:
    print(f"⚠️ Tavily client not available: {e}")
    tavily_client = None

# --- User Data Storage (medicines, documents, food log, health metrics) ---
USER_DATA_DIR = "user_data"
DOCUMENTS_DIR = os.path.join(USER_DATA_DIR, "documents")
os.makedirs(DOCUMENTS_DIR, exist_ok=True)

# Initialize the SQLite store (also migrates any legacy JSON on first run)
db.init_db()

# --- Initialize Flask ---
app = Flask(__name__)
CORS(app)  # Enables Cross-Origin Resource Sharing

# Ensure cache directory exists
os.makedirs(CACHE_DIR, exist_ok=True)


def calculate_haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Calculates the great-circle distance between two points on Earth in meters.
    """
    earth_radius = 6371000.0  # meters
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = (math.sin(delta_phi / 2.0) ** 2) + (
        math.cos(phi1) * math.cos(phi2) * (math.sin(delta_lambda / 2.0) ** 2)
    )
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return earth_radius * c


def get_cached_assessment(lat: float, lon: float, radius: int) -> Optional[Dict[str, Any]]:
    """
    Checks if a persistent assessment file exists within CACHE_DISTANCE_THRESHOLD_METERS.
    """
    if not os.path.exists(CACHE_DIR):
        return None

    for filename in os.listdir(CACHE_DIR):
        if filename.endswith(".json"):
            filepath = os.path.join(CACHE_DIR, filename)
            try:
                with open(filepath, 'r') as f:
                    cached_data = json.load(f)

                meta = cached_data.get("metadata", {}).get("target_location", {})
                c_lat = meta.get("lat")
                c_lon = meta.get("lon")
                c_radius = meta.get("radius_meters")

                if c_lat is not None and c_lon is not None and c_radius == radius:
                    dist = calculate_haversine_distance(lat, lon, float(c_lat), float(c_lon))
                    if dist <= CACHE_DISTANCE_THRESHOLD_METERS:
                        print(f"⚡ CACHE HIT! Served data from persistent file {filename} (Distance: {round(dist, 1)}m)")
                        cached_data["metadata"]["cached"] = True
                        return cached_data
            except Exception as e:
                print(f"⚠️ Error reading cache file {filename}: {e}")

    return None


def save_to_cache(lat: float, lon: float, radius: int, data: Dict[str, Any]):
    """
    Saves a fresh assessment result persistently to a folder.
    """
    os.makedirs(CACHE_DIR, exist_ok=True)
    filename = f"assessment_{lat}_{lon}_{radius}m.json"
    filepath = os.path.join(CACHE_DIR, filename)

    try:
        with open(filepath, 'w') as f:
            json.dump(data, f, indent=4)
        print(f"💾 Saved assessment for ({lat}, {lon}) persistently to {filepath}.")
    except Exception as e:
        print(f"❌ Error saving to cache folder: {e}")


def _encode_image_base64(image_path: str, max_dim: int = 768) -> str:
    """Read an image file, downscale (if needed) and return base64-encoded contents for Ollama vision."""
    import base64
    from io import BytesIO
    from PIL import Image

    try:
        with Image.open(image_path) as img:
            img = img.convert("RGB")
            if max(img.size) > max_dim:
                img.thumbnail((max_dim, max_dim))
            buf = BytesIO()
            img.save(buf, format="JPEG", quality=85)
            return base64.b64encode(buf.getvalue()).decode("utf-8")
    except Exception:
        with open(image_path, "rb") as f:
            return base64.b64encode(f.read()).decode("utf-8")


def analyze_image_with_ollama(
    image_path: str,
    image_id: Optional[str] = None,
    context: Optional[Dict[str, Any]] = None,
) -> dict:
    """Passes a single image + GBIF/Meteo context to the vision model (qwen2.5vl)."""
    file_name = os.path.basename(image_path)
    print(f"🤖 Analyzing image: {file_name}")

    image_b64 = _encode_image_base64(image_path)

    context_block = ""
    if context:
        gbif = context.get("gbif_data", {}) or {}
        meteo = (context.get("open_meteo_data", {}) or {}).get("summary", {}) or {}

        species = gbif.get("species", [])[:15]
        species_lines = "\n".join(
            f"  - {sp.get('scientific_name')} (common: {sp.get('vernacular_name')}, "
            f"observed {sp.get('occurrence_count')}x)"
            for sp in species
        ) or "  (none reported)"

        context_block = (
            "\n\n# REAL-TIME CONTEXT FOR THIS LOCATION (use to judge ON-TIME risk)\n"
            f"Local botanical species recorded nearby (GBIF):\n{species_lines}\n"
            f"Current weather: temp={meteo.get('temperature_c')}°C, "
            f"humidity={meteo.get('humidity_pct')}%, "
            f"wind={meteo.get('wind_speed_kmh')} km/h, "
            f"cloud_cover={meteo.get('cloud_cover_pct')}%, "
            f"UV={meteo.get('uv_index')}\n"
            f"Air quality: US_AQI={meteo.get('us_aqi')}, PM2.5={meteo.get('pm2_5')}, "
            f"dominant_pollen={meteo.get('dominant_pollen')}\n"
            "Cross-reference visible vegetation with the species list and current "
            "conditions to assess the actual present-day allergy risk.\n"
        )

    prompt = (
        "You are analyzing a street-level photo for seasonal/pollen/mold allergies. "
        "Identify any visible trees, bushes, shrubs, grasses, weeds, or damp/mold environments. "
        "Return ONLY a valid JSON object with the following schema:\n"
        "{\n"
        '  "detected_triggers": ["short labels of identified plants/weeds/trees/mold sources"],\n'
        '  "risk_severity": "low | medium | high",\n'
        '  "observations": "ONE short sentence stating the issue only. No fluff, no paragraphs."\n'
        "}"
        + context_block
    )

    try:
        response = chat(
            model=VISION_MODEL,
            messages=[
                {
                    "role": "user",
                    "content": prompt,
                    "images": [image_b64],
                }
            ],
            format="json",
            options={
                "temperature": 0.2,
                "top_p": 0.95,
                "top_k": 64,
            },
        )

        parsed_analysis = json.loads(response.message.content)
        return {
            "image_id": image_id,
            "file": file_name,
            "path": image_path,
            "image_url": None,  # filled later by caller
            "detected_triggers": parsed_analysis.get("detected_triggers", []),
            "risk_severity": parsed_analysis.get("risk_severity", "unknown"),
            "observations": parsed_analysis.get("observations", "")
        }
    except Exception as e:
        print(f"❌ Error analyzing {file_name}: {e}")
        return {
            "image_id": image_id,
            "file": file_name,
            "path": image_path,
            "image_url": None,
            "error": str(e),
            "detected_triggers": [],
            "risk_severity": "unknown",
            "observations": "Failed to analyze image."
        }


def generate_final_alert(aggregated_data: dict) -> dict:
    """Sends aggregated environmental data to the reasoning model (gemma4:e4b)."""
    print("\n🧠 Querying local reasoning model for final JSON allergy risk assessment...")

    prompt_payload = {
        "visual_vegetation_analysis": aggregated_data.get("visual_analysis", []),
        "local_plant_species": [
            {"name": sp["scientific_name"], "common": sp["vernacular_name"], "count": sp["occurrence_count"]}
            for sp in aggregated_data.get("gbif_data", {}).get("species", [])[:20]
        ],
        "weather_and_air_quality": aggregated_data.get("open_meteo_data", {}).get("summary", {})
    }

    system_prompt = (
        "You are an expert environmental scientist and allergist. Analyze multi-source environmental data "
        "(street image vision analysis, historical local plant occurrences, and weather/air quality metrics).\n\n"
        "Return your assessment ONLY as a valid JSON object using the following exact structure:\n"
        "{\n"
        '  "overall_risk_score": 7.3,\n'
        '  "overall_risk_level": "LOW | MODERATE | HIGH | VERY HIGH",\n'
        '  "primary_risk_drivers": ["Grass pollen", "High PM2.5", "Wind carrying pollen", "Dense roadside vegetation"],\n'
        '  "executive_summary": "ONE short sentence stating the single main allergy issue. No paragraphs, no extra detail.",\n'
        '  "hourly_timeline": [\n'
        '    {"time": "6 AM", "risk": "Low", "score": 20}, {"time": "9 AM", "risk": "Medium", "score": 50},\n'
        '    {"time": "12 PM", "risk": "High", "score": 80}, {"time": "3 PM", "risk": "Extreme", "score": 95},\n'
        '    {"time": "6 PM", "risk": "Moderate", "score": 55}, {"time": "Night", "risk": "Low", "score": 25}\n'
        '  ],\n'
        '  "daily_risk_forecast": [\n'
        '    {"day": "Mon", "risk": "Low", "score": 30}, {"day": "Tue", "risk": "Moderate", "score": 55},\n'
        '    {"day": "Wed", "risk": "Low", "score": 25}, {"day": "Thu", "risk": "High", "score": 80}\n'
        "  ],\n"
        '  "trigger_breakdown": {\n'
        '    "grass": 42,\n'
        '    "trees": 27,\n'
        '    "mold": 18,\n'
        '    "pollution": 13\n'
        '  },\n'
        '  "time_based_recommendations": {\n'
        '    "morning": "Wear mask during morning walk",\n'
        '    "afternoon": "Avoid parks and high vegetation areas",\n'
        '    "evening": "Antihistamine recommended",\n'
        '    "night": "Keep windows closed and ventilate room with air purifier"\n'
        '  },\n'
        '  "confidence_score": "94%",\n'
        '  "image_specific_alerts": [\n'
        "    {\n"
        '      "image_file": "filename.jpg",\n'
        '      "image_id": "image_id_here",\n'
        '      "trigger_type": "Tree / Pollen / Mold / Weed",\n'
        '      "identified_hazard": "Specific hazard description",\n'
        '      "alert_severity": "Low | Medium | High"\n'
        "    }\n"
        "  ],\n"
        '  "botanical_and_weather_triggers": [\n'
        "    {\n"
        '      "source": "GBIF | Weather | Air Quality",\n'
        '      "trigger": "Trigger name",\n'
        '      "details": "Details about why this presents a risk"\n'
        "    }\n"
        "  ],\n"
        '  "top_plants": [\n'
        "    {\n"
        '      "plant": "Common / scientific plant name present in the area",\n'
        '      "presence_reason": "Why this plant is likely present (GBIF / visual / seasonal)",\n'
        '      "allergies_triggered": ["Allergy types e.g. Hay fever, Asthma, Skin rash"],\n'
        '      "pollen_level": "None | Low | Moderate | High | Very High",\n'
        '      "pollen_type": "Wind-borne / Insect / None",\n'
        '      "peak_season": "e.g. Spring, Late summer"\n'
        "    }\n"
        "  ],\n"
        '  "preventative_recommendations": ["list of recommendations for allergic individuals"]\n'
        "}\n\n"
        "CRITICAL: Under 'top_plants', list the top 5 plants most likely to be present in the area that "
        "could trigger allergies. Use the GBIF species list and the visual analysis vegetation to pick them. "
        "For each, specify the allergies they trigger, the pollen level and pollen type.\n"
        "CRITICAL: Under 'image_specific_alerts', explicitly link each detected visual issue back "
        "to the exact 'file' and 'image_id' provided in visual_vegetation_analysis.\n"
        "For hourly_timeline and daily_risk_forecast, 'score' is an integer 0-100 representing severity."
    )

    try:
        response = chat(
            model=REASON_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"Here is the environmental data for the target location:\n\n{json.dumps(prompt_payload, indent=2)}"}
            ],
            format="json",
            options={
                "temperature": 0.3,
                "top_p": 0.95,
                "top_k": 64,
            },
        )
        return json.loads(response.message.content)
    except Exception as e:
        print(f"❌ Error generating alert: {e}")
        return {
            "error": str(e),
            "overall_risk_score": 5.0,
            "overall_risk_level": "MODERATE",
            "primary_risk_drivers": ["Data synthesis incomplete"],
            "executive_summary": "Failed to generate structured assessment.",
            "hourly_timeline": [],
            "daily_risk_forecast": [],
            "trigger_breakdown": {"grass": 25, "trees": 25, "mold": 25, "pollution": 25},
            "time_based_recommendations": {},
            "confidence_score": "0%",
            "image_specific_alerts": [],
            "botanical_and_weather_triggers": [],
            "top_plants": [],
            "preventative_recommendations": []
        }

# --- API Endpoints ---

@app.route("/api/v1/allergy-assessment", methods=["POST"])
def assess_allergy_risk():
    data = request.json

    if not data or 'lat' not in data or 'lon' not in data:
        return jsonify({"error": "Missing 'lat' or 'lon' in request body"}), 400

    lat = float(data['lat'])
    lon = float(data['lon'])
    radius = int(data.get('radius_meters', 50))

    # --- Step 0: Check Geospatial Persistent Cache ---
    cached_response = get_cached_assessment(lat, lon, radius)
    if cached_response:
        return jsonify(cached_response)

    print(f"\n🌍 Starting Fresh Assessment for Lat: {lat}, Lon: {lon}, Radius: {radius}m")

    # 1. GBIF Pipeline (fetch botanical data FIRST)
    print("🌿 Step 1: Fetching local botanical records via GBIF...")
    gbif_data = get_local_plant_species(lat, lon, radius_km=10)

    # 2. Open-Meteo Pipeline (fetch weather/AQI/pollen FIRST)
    print("🌦️  Step 2: Fetching real-time weather and air quality via Open-Meteo...")
    meteo_data = get_environmental_data(lat, lon)

    # Build the shared on-time context to feed into the vision model alongside images
    shared_context = {
        "gbif_data": gbif_data,
        "open_meteo_data": meteo_data,
    }

    # 3. Mapillary Pipeline (fetch imagery, then analyze WITH gbif+meteo context)
    print("📸 Step 3: Fetching Mapillary imagery...")
    finder = MapillaryPhotosFinder(MAPILLARY_TOKEN)
    images = finder.get_images_around_location(lat, lon, radius_meters=radius, exclude_panoramas=True)

    visual_analysis_results = []
    image_metadata_map = {}

    if images:
        folder_name = f"mapillary_{lat}_{lon}_{radius}m"
        finder.download_and_sort_images(images, folder_name, blur_threshold=100.0)

        for img in images:
            img_id = str(img.get('id'))
            coords = img.get('computed_geometry') or img.get('geometry')
            img_lon, img_lat = coords['coordinates'] if coords else (None, None)

            image_metadata_map[img_id] = {
                "image_id": img_id,
                "lat": img_lat,
                "lon": img_lon,
                "distance_meters": img.get('distance_meters')
            }

        clear_dir = os.path.join(folder_name, "clear")
        if os.path.exists(clear_dir):
            clear_images = glob.glob(os.path.join(clear_dir, "*.jpg"))
            if clear_images:
                print(f"👁️  Step 3b: Running context-aware vision analysis on {len(clear_images)} clear images...")
                for img_path in clear_images:
                    file_name = os.path.basename(img_path)
                    matched_id = next((img_id for img_id in image_metadata_map if img_id in file_name), None)

                    analysis = analyze_image_with_ollama(
                        img_path, image_id=matched_id, context=shared_context
                    )

                    if matched_id and matched_id in image_metadata_map:
                        analysis["location"] = image_metadata_map[matched_id]

                    # Expose a servable URL + coords for the interactive map
                    analysis["image_url"] = f"/{folder_name}/clear/{file_name}"
                    if analysis.get("location"):
                        analysis["lat"] = analysis["location"].get("lat")
                        analysis["lon"] = analysis["location"].get("lon")

                    visual_analysis_results.append(analysis)

    # Assemble master data structure
    master_data = {
        "metadata": {
            "timestamp": datetime.now().isoformat(),
            "target_location": {"lat": lat, "lon": lon, "radius_meters": radius},
            "cached": False
        },
        "mapillary_images_metadata": list(image_metadata_map.values()),
        "visual_analysis": visual_analysis_results,
        "gbif_data": gbif_data,
        "open_meteo_data": meteo_data
    }

    # 4. Final Gemma Reasoning Pipeline
    gemma_assessment = generate_final_alert(master_data)
    master_data["gemma_allergy_assessment"] = gemma_assessment

    # Save completed result to permanent file cache
    save_to_cache(lat, lon, radius, master_data)

    return jsonify(master_data)


COVERAGE_DIR = "coverage_cache"
os.makedirs(COVERAGE_DIR, exist_ok=True)

@app.route("/api/v1/mapillary-coverage", methods=["GET"])
def mapillary_coverage():
    """Fetch (and server-side cache) Mapillary coverage points around a location."""
    try:
        lat = float(request.args.get("lat"))
        lon = float(request.args.get("lon"))
        radius = int(request.args.get("radius_meters", 15000))
    except (TypeError, ValueError):
        return jsonify({"error": "lat, lon (numbers) and optional radius_meters required"}), 400

    # Cache coverage by rounded location + radius so we don't re-hit Mapillary each time.
    cache_name = f"coverage_{round(lat,5)}_{round(lon,5)}_{radius}m.json"
    cache_path = os.path.join(COVERAGE_DIR, cache_name)
    if os.path.exists(cache_path):
        with open(cache_path) as f:
            return jsonify(json.load(f))

    finder = MapillaryPhotosFinder(MAPILLARY_TOKEN)
    coverage = finder.get_coverage_points(lat, lon, radius_meters=radius)
    coverage["target_location"] = {"lat": lat, "lon": lon, "radius_meters": radius}

    try:
        with open(cache_path, "w") as f:
            json.dump(coverage, f, indent=2)
        print(f"💾 Saved Mapillary coverage for ({lat}, {lon}) to {cache_path}")
    except Exception as e:
        print(f"❌ Error saving coverage cache: {e}")

    return jsonify(coverage)


@app.route('/<path:filepath>')
def serve_static_files(filepath):
    if filepath.startswith("mapillary_") or filepath.startswith("user_data/"):
        directory = os.path.dirname(filepath)
        filename = os.path.basename(filepath)
        base_dir = os.path.abspath(".")
        target_dir = os.path.join(base_dir, directory)
        if os.path.exists(os.path.join(target_dir, filename)):
            return send_from_directory(target_dir, filename)
        else:
            abort(404)
    abort(404)


# ===================== USER DATA ENDPOINTS (SQLite-backed) =====================

# ---- Medicines ----
@app.route("/api/v1/medicines", methods=["GET", "POST", "DELETE"])
def medicines():
    if request.method == "GET":
        return jsonify(db.get_medicines())
    if request.method == "POST":
        body = request.json or {}
        item = {
            "id": str(uuid.uuid4()),
            "name": body.get("name", "Unnamed"),
            "expiry": body.get("expiry", ""),
            "added": datetime.now().isoformat(),
        }
        db.insert_medicine(item)
        return jsonify(item), 201
    if request.method == "DELETE":
        body = request.json or {}
        db.delete_medicine(body.get("id"))
        return jsonify({"ok": True})


# ---- Health Documents ----
ALLOWED_DOC_EXT = {".pdf", ".png", ".jpg", ".jpeg", ".webp", ".gif"}

@app.route("/api/v1/documents", methods=["GET", "POST"])
def documents():
    if request.method == "GET":
        q = (request.args.get("q") or "").lower()
        return jsonify(db.get_documents(q))
    # POST multipart
    name = request.form.get("name", "")
    file = request.files.get("file")
    if not file:
        return jsonify({"error": "no file"}), 400
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED_DOC_EXT:
        return jsonify({"error": "unsupported file type"}), 400
    fname = secure_filename(f"{uuid.uuid4().hex}{ext}")
    fpath = os.path.join(DOCUMENTS_DIR, fname)
    file.save(fpath)
    doc = {
        "id": str(uuid.uuid4()),
        "name": name or file.filename,
        "file": fname,
        "url": f"/user_data/documents/{fname}",
        "type": ext,
        "added": datetime.now().isoformat(),
    }
    db.insert_document(doc)
    return jsonify(doc), 201


# ---- Food Log (AI calorie + risk analysis) ----
def analyze_food_with_ollama(image_path: str) -> dict:
    image_b64 = _encode_image_base64(image_path)
    prompt = (
        "You are a nutritionist AI analyzing a photo of food. "
        "Estimate calories and identify any allergy/health risks in the meal. "
        "Return ONLY a valid JSON object:\n"
        "{\n"
        '  "calories": number (estimated kcal),\n'
        '  "risks": ["list of allergy or health risk keywords"],\n'
        '  "description": "ONE short sentence stating the meal and its main risk. No paragraphs."\n'
        "}"
    )
    try:
        response = chat(
            model=VISION_MODEL,
            messages=[{"role": "user", "content": prompt, "images": [image_b64]}],
            format="json",
            options={"temperature": 0.3, "top_p": 0.95, "top_k": 64},
        )
        return json.loads(response.message.content)
    except Exception as e:
        return {"calories": 0, "risks": [], "description": f"Analysis failed: {e}"}

FOOD_IMAGES_DIR = os.path.join(USER_DATA_DIR, "food_images")
os.makedirs(FOOD_IMAGES_DIR, exist_ok=True)

@app.route("/api/v1/analyze-food", methods=["POST"])
def analyze_food():
    file = request.files.get("file")
    if not file:
        return jsonify({"error": "no file"}), 400
    ext = os.path.splitext(file.filename)[1].lower() or ".jpg"
    fname = f"{uuid.uuid4().hex}{ext}"
    fpath = os.path.join(FOOD_IMAGES_DIR, fname)
    file.save(fpath)
    result = analyze_food_with_ollama(fpath)
    entry = {
        "id": str(uuid.uuid4()),
        "timestamp": datetime.now().isoformat(),
        "image": f"/user_data/food_images/{fname}",
        "calories": result.get("calories", 0),
        "risks": result.get("risks", []),
        "description": result.get("description", ""),
    }
    db.insert_food_log(entry)
    return jsonify(entry), 201

@app.route("/api/v1/food-log", methods=["GET"])
def food_log():
    return jsonify(db.get_food_log())


# ---- Health Metrics (manual data) ----
@app.route("/api/v1/health-data", methods=["GET", "POST", "DELETE"])
def health_data():
    if request.method == "GET":
        return jsonify(db.get_health_data())
    if request.method == "POST":
        body = request.json or {}
        entry = {
            "id": str(uuid.uuid4()),
            "timestamp": datetime.now().isoformat(),
            "metrics": body.get("metrics", {}),  # e.g. {"blood_pressure": "120/80", "sugar": 90}
        }
        db.insert_health_data(entry)
        return jsonify(entry), 201
    if request.method == "DELETE":
        body = request.json or {}
        db.delete_health_data(body.get("id"))
        return jsonify({"ok": True})


# ---- Tavily: best-price medicine finder ----
@app.route("/api/v1/medicine-prices", methods=["POST"])
def medicine_prices():
    if not tavily_client:
        return jsonify({"error": "Tavily client not configured"}), 503

    body = request.json or {}
    medicine = body.get("medicine", "")

    if not medicine:
        return jsonify({"error": "medicine name required"}), 400

    query = (
        f"What is the exact price of {medicine} online in India? "
        f"State ONLY the price in Rupees (₹) and the pharmacy name."
    )

    try:
        response = tavily_client.search(
            query=query,
            search_depth="basic",
            include_answer="basic",
            max_results=3
        )

        clean_results = []
        for r in response.get("results", []):
            raw_title = r.get("title", "")
            raw_content = r.get("content", "")

            # Clean up SEO titles (removes everything after a pipe '|')
            clean_title = raw_title.split('|')[0].strip()

            # Regex to find the Indian Rupee symbol (₹) or "Rs" followed by numbers
            price_match = re.search(r'(₹|Rs\.?)\s*\d+(?:\.\d+)?', raw_content, re.IGNORECASE)

            if price_match:
                # If a price is found, discard all markdown/junk and show ONLY the price
                clean_content = f"Price found: {price_match.group(0)}"
            else:
                # Clean fallback for table rows or missing prices
                clean_content = "Tap link to view pricing details."

            clean_results.append({
                "title": clean_title,
                "url": r.get("url", ""),
                "content": clean_content
            })

        return jsonify({
            "query": query,
            "answer": response.get("answer", ""),
            "results": clean_results,
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ---- User Allergies (selected pollen/triggers) ----
@app.route("/api/v1/allergies", methods=["GET", "POST", "DELETE"])
def allergies():
    if request.method == "GET":
        return jsonify(db.get_allergies())
    if request.method == "POST":
        body = request.json or {}
        name = (body.get("name") or "").strip()
        if not name:
            return jsonify({"error": "name required"}), 400
        if db.allergy_exists(name):
            return jsonify({"ok": True, "duplicate": True}), 200
        item = {"id": str(uuid.uuid4()), "name": name, "added": datetime.now().isoformat()}
        db.insert_allergy(item)
        return jsonify(item), 201
    if request.method == "DELETE":
        body = request.json or {}
        db.delete_allergy(body.get("id"))
        return jsonify({"ok": True})


# ---- Allergy Match (uncached, uses existing assessment + user allergies) ----
# ---------------------------------------------------------------------------
# Deterministic (grep-style) allergy matching
# ---------------------------------------------------------------------------
_ALLERGY_CATEGORIES = {
    "grass": ["grass", "poaceae", "lawn", "meadow", "gramineae"],
    "tree": ["tree", "trees", "birch", "alder", "oak", "pine", "olive", "cedar",
             "maple", "willow", "cypress", "poplar", "ash", "elm", "hazel"],
    "weed": ["weed", "ragweed", "mugwort", "nettle", "amaranth", "cocklebur", "sagebrush"],
    "dust": ["dust", "mite", "mites"],
    "mold": ["mold", "mould", "fungus", "fungal", "spore", "spores", "mildew"],
    "animal": ["animal", "cat", "dog", "pet", "dander", "fur", "feather"],
    "pollution": ["pollution", "pm2", "pm10", "aqi", "smog", "no2", "ozone", "so2"],
    "smoke": ["smoke", "wildfire", "fire", "fumes"],
    "insect": ["insect", "bee", "wasp", "mosquito", "sting"],
}

_KEYWORD_NOISE = {"pollen", "pollination", "anthesis"}
_STOPWORDS = {"allergy", "allergies", "the", "and", "of", "a", "an", "i", "my", "to"}


def _normalize_tokens(text: str):
    """Lowercase, split into significant word tokens (>=2 chars, non-stopword)."""
    if not text:
        return []
    toks = []
    for raw in str(text).lower().split():
        w = "".join(ch for ch in raw if ch.isalnum())
        if w and w not in _STOPWORDS and len(w) >= 2:
            toks.append(w)
    return toks


def _allergy_keywords(allergy_name: str):
    """Expand a user allergy string into the set of literal keywords we search for."""
    base = _normalize_tokens(allergy_name)
    keywords = set()
    for tok in base:
        if not tok or tok in _KEYWORD_NOISE:
            continue
        keywords.add(tok)
        if tok in _ALLERGY_CATEGORIES:
            keywords.update(_ALLERGY_CATEGORIES[tok])
    return keywords


def _severity_from_hint(hint: str) -> str:
    h = (hint or "").lower()
    if "very high" in h or "high" in h or "extreme" in h:
        return "high"
    if "moderate" in h or "medium" in h:
        return "medium"
    if "low" in h or "none" in h:
        return "low"
    return None


def _build_search_corpus(assessment: dict):
    """Flatten the assessment into a list of searchable items."""
    gemma = assessment.get("gemma_allergy_assessment", {}) or {}
    meteo = (assessment.get("open_meteo_data", {}) or {}).get("summary", {}) or {}

    corpus = []

    for v in assessment.get("visual_analysis", []) or []:
        triggers = v.get("detected_triggers", []) or []
        text = " ".join(triggers)
        corpus.append((
            f"visual:{v.get('file', 'scan')}",
            text,
            v.get("risk_severity"),
        ))

    for p in gemma.get("top_plants", []) or []:
        plant = p.get("plant", "") or ""
        triggered = " ".join(p.get("allergies_triggered", []) or [])
        pollen = p.get("pollen_level", "") or ""
        text = f"{plant} {triggered} pollen:{pollen}"
        corpus.append((
            f"top_plant:{plant}",
            text,
            pollen,
        ))

    for t in gemma.get("botanical_and_weather_triggers", []) or []:
        text = f"{t.get('source', '')} {t.get('trigger', '')} {t.get('details', '')}"
        corpus.append((
            f"botanical:{t.get('trigger', 'trigger')}",
            text,
            None,
        ))

    drivers = " ".join(gemma.get("primary_risk_drivers", []) or [])
    if drivers:
        corpus.append(("drivers", drivers, None))

    for k, val in (gemma.get("trigger_breakdown", {}) or {}).items():
        corpus.append((f"breakdown:{k}", f"{k} {val}", None))

    dom = meteo.get("dominant_pollen")
    if dom:
        corpus.append(("dominant_pollen", str(dom), None))

    weather_bits = [
        meteo.get("dominant_pollen"),
        meteo.get("air_quality_description"),
        meteo.get("weather_description"),
    ]
    weather_text = " ".join(str(b) for b in weather_bits if b)
    if weather_text:
        corpus.append(("weather", weather_text, None))

    return corpus


def _match_allergy(allergy_name: str, corpus):
    """Grep the corpus for the allergy."""
    keywords = _allergy_keywords(allergy_name)
    if not keywords:
        return {
            "allergy": allergy_name, "detected": False, "occurrences": 0,
            "severity": "low", "note": "No searchable keywords for this allergy.",
            "sources": [],
        }

    occurrences = 0
    sources = []
    severity_levels = []

    for label, text, hint in corpus:
        tl = text.lower()
        full_phrase = allergy_name.lower().strip()
        hit = full_phrase in tl
        if not hit:
            for kw in keywords:
                if kw and (f" {kw} " in f" {tl} " or kw in tl):
                    hit = True
                    break
        if hit:
            occurrences += 1
            sev = _severity_from_hint(hint)
            snippet = text.strip()[:60]
            sources.append(f"{label} ({snippet})")
            if sev:
                severity_levels.append(sev)

    detected = occurrences > 0

    if "high" in severity_levels:
        severity = "high"
    elif "medium" in severity_levels or occurrences >= 2:
        severity = "medium"
    elif detected:
        severity = "low"
    else:
        severity = "low"

    if detected:
        note = (f"Found in {occurrences} source(s) across the assessment data "
                f"(visual, plants, pollen, weather).")
    else:
        note = "No matching signal found anywhere in the assessment data."

    return {
        "allergy": allergy_name,
        "detected": detected,
        "occurrences": occurrences,
        "severity": severity,
        "note": note,
        "sources": sources[:8],
    }


def generate_allergy_match(assessment: dict, user_allergies: list) -> dict:
    """Deterministic, grep-style match of the user's allergies against the assessment."""
    print("\n🔎 Running deterministic (grep-style) allergy match over assessment data...")

    corpus = _build_search_corpus(assessment)
    matches = []
    for a in user_allergies:
        name = a.get("name") if isinstance(a, dict) else str(a)
        matches.append(_match_allergy(name, corpus))

    return {"matches": matches}


@app.route("/api/v1/allergy-match", methods=["POST"])
def allergy_match():
    body = request.json or {}
    assessment = body.get("assessment")
    if not assessment:
        return jsonify({"error": "assessment object required"}), 400
    user_allergies = db.get_allergies()
    if not user_allergies:
        return jsonify({"matches": [], "note": "No user allergies configured."})
    result = generate_allergy_match(assessment, user_allergies)
    return jsonify(result)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("FLASK_PORT", 8000)), debug=True)
