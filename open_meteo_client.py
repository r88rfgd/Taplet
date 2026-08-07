"""
open_meteo_client.py
=====================
Robust client for the Open-Meteo Forecast API + Air Quality API.

No API key required (non-commercial use). Docs:
  - Weather Forecast API : https://open-meteo.com/en/docs
  - Air Quality API      : https://open-meteo.com/en/docs/air-quality-api

Given a latitude/longitude, `get_environmental_data()` returns a single
consolidated dict with:
  - location metadata (resolved lat/lon, elevation, timezone)
  - current conditions (temperature, humidity, wind speed/dir/gusts,
    precipitation, cloud cover, pressure, UV index, weather code)
  - daily forecast summary (temp min/max, precip sum, wind max, sunrise/set)
  - hourly forecast (temperature, humidity, wind, precipitation probability)
  - air quality (PM10, PM2.5, CO, NO2, SO2, O3, dust, European & US AQI)
  - pollen (alder, birch, grass, mugwort, olive, ragweed) -- Europe only,
    values are `None` outside the CAMS European domain.

Design notes:
  - Uses a requests.Session with urllib3 Retry (exponential backoff) for
    transient network / 5xx errors.
  - Each sub-request (weather, air quality) is isolated: if one endpoint
    fails, the other's data is still returned, with an "errors" key
    describing what went wrong.
  - Pure standard-lib + requests, no other dependencies.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

logger = logging.getLogger("open_meteo_client")

FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
AIR_QUALITY_URL = "https://air-quality-api.open-meteo.com/v1/air-quality"

DEFAULT_TIMEOUT = 15  # seconds

CURRENT_WEATHER_VARS = [
    "temperature_2m",
    "relative_humidity_2m",
    "apparent_temperature",
    "is_day",
    "precipitation",
    "rain",
    "showers",
    "snowfall",
    "weather_code",
    "cloud_cover",
    "pressure_msl",
    "surface_pressure",
    "wind_speed_10m",
    "wind_direction_10m",
    "wind_gusts_10m",
    "uv_index",
]

HOURLY_WEATHER_VARS = [
    "temperature_2m",
    "relative_humidity_2m",
    "dew_point_2m",
    "apparent_temperature",
    "precipitation_probability",
    "precipitation",
    "weather_code",
    "cloud_cover",
    "wind_speed_10m",
    "wind_direction_10m",
    "wind_gusts_10m",
    "uv_index",
]

DAILY_WEATHER_VARS = [
    "weather_code",
    "temperature_2m_max",
    "temperature_2m_min",
    "apparent_temperature_max",
    "apparent_temperature_min",
    "sunrise",
    "sunset",
    "uv_index_max",
    "precipitation_sum",
    "precipitation_probability_max",
    "wind_speed_10m_max",
    "wind_gusts_10m_max",
    "wind_direction_10m_dominant",
]

# Pollen variables: only populated in Europe, during pollen season, ~4 day forecast.
POLLEN_VARS = [
    "alder_pollen",
    "birch_pollen",
    "grass_pollen",
    "mugwort_pollen",
    "olive_pollen",
    "ragweed_pollen",
]

AIR_QUALITY_HOURLY_VARS = [
    "pm10",
    "pm2_5",
    "carbon_monoxide",
    "nitrogen_dioxide",
    "sulphur_dioxide",
    "ozone",
    "dust",
    "aerosol_optical_depth",
    "uv_index",
    "european_aqi",
    "european_aqi_pm2_5",
    "european_aqi_pm10",
    "european_aqi_nitrogen_dioxide",
    "european_aqi_ozone",
    "european_aqi_sulphur_dioxide",
    "us_aqi",
    "us_aqi_pm2_5",
    "us_aqi_pm10",
] + POLLEN_VARS

AIR_QUALITY_CURRENT_VARS = [
    "european_aqi",
    "us_aqi",
    "pm10",
    "pm2_5",
    "carbon_monoxide",
    "nitrogen_dioxide",
    "sulphur_dioxide",
    "ozone",
    "dust",
    "uv_index",
] + POLLEN_VARS


def _build_session(total_retries: int = 4, backoff_factor: float = 0.6) -> requests.Session:
    """A requests Session configured to retry on transient failures."""
    session = requests.Session()
    retry = Retry(
        total=total_retries,
        read=total_retries,
        connect=total_retries,
        backoff_factor=backoff_factor,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=frozenset(["GET"]),
        raise_on_status=False,
    )
    adapter = HTTPAdapter(max_retries=retry)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return session


@dataclass
class OpenMeteoError:
    endpoint: str
    message: str


@dataclass
class OpenMeteoClient:
    """Client for weather + air quality/pollen data from Open-Meteo."""

    session: requests.Session = field(default_factory=_build_session)
    timeout: int = DEFAULT_TIMEOUT

    # ------------------------------------------------------------------ #
    # Low-level helpers
    # ------------------------------------------------------------------ #
    def _get(self, url: str, params: Dict[str, Any]) -> Dict[str, Any]:
        response = self.session.get(url, params=params, timeout=self.timeout)
        if response.status_code != 200:
            try:
                payload = response.json()
                reason = payload.get("reason", response.text)
            except ValueError:
                reason = response.text
            raise RuntimeError(f"HTTP {response.status_code} from {url}: {reason}")
        return response.json()

    # ------------------------------------------------------------------ #
    # Weather (temperature, humidity, wind, precipitation, UV, ...)
    # ------------------------------------------------------------------ #
    def get_weather(
        self,
        lat: float,
        lon: float,
        forecast_days: int = 7,
        past_days: int = 0,
        timezone: str = "auto",
    ) -> Dict[str, Any]:
        """Fetch current + hourly + daily weather from the Forecast API."""
        params = {
            "latitude": lat,
            "longitude": lon,
            "current": ",".join(CURRENT_WEATHER_VARS),
            "hourly": ",".join(HOURLY_WEATHER_VARS),
            "daily": ",".join(DAILY_WEATHER_VARS),
            "forecast_days": forecast_days,
            "past_days": past_days,
            "timezone": timezone,
            "wind_speed_unit": "kmh",
            "temperature_unit": "celsius",
            "precipitation_unit": "mm",
        }
        return self._get(FORECAST_URL, params)

    # ------------------------------------------------------------------ #
    # Air quality + pollen
    # ------------------------------------------------------------------ #
    def get_air_quality(
        self,
        lat: float,
        lon: float,
        forecast_days: int = 5,
        past_days: int = 0,
        timezone: str = "auto",
        domains: str = "auto",
    ) -> Dict[str, Any]:
        """Fetch current + hourly pollutant & pollen data from the Air Quality API.

        Pollen (alder/birch/grass/mugwort/olive/ragweed) is only populated
        for locations inside the CAMS European domain, during that plant's
        pollen season, and only for a ~4 day forecast horizon. Outside of
        that the API returns null for those fields -- this is expected
        behaviour, not an error.
        """
        params = {
            "latitude": lat,
            "longitude": lon,
            "current": ",".join(AIR_QUALITY_CURRENT_VARS),
            "hourly": ",".join(AIR_QUALITY_HOURLY_VARS),
            "forecast_days": forecast_days,
            "past_days": past_days,
            "timezone": timezone,
            "domains": domains,
        }
        return self._get(AIR_QUALITY_URL, params)

    # ------------------------------------------------------------------ #
    # Consolidated call
    # ------------------------------------------------------------------ #
    def get_environmental_data(
        self,
        lat: float,
        lon: float,
        forecast_days: int = 7,
        timezone: str = "auto",
    ) -> Dict[str, Any]:
        """Fetch weather + air quality/pollen and merge into one report.

        Never raises for a single failed sub-request -- failures are
        collected in result["errors"] so the caller always gets whatever
        data *is* available (e.g. weather succeeds even if the air-quality
        service is briefly down).
        """
        result: Dict[str, Any] = {
            "request": {"latitude": lat, "longitude": lon, "forecast_days": forecast_days},
            "weather": None,
            "air_quality": None,
            "errors": [],
        }

        try:
            result["weather"] = self.get_weather(lat, lon, forecast_days=forecast_days, timezone=timezone)
        except Exception as exc:  # noqa: BLE001 - want to capture and continue
            logger.warning("Weather fetch failed: %s", exc)
            result["errors"].append({"endpoint": "forecast", "message": str(exc)})

        try:
            # Air quality API caps forecast_days at 7; pollen realistically ~4.
            result["air_quality"] = self.get_air_quality(
                lat, lon, forecast_days=min(forecast_days, 7), timezone=timezone
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("Air quality fetch failed: %s", exc)
            result["errors"].append({"endpoint": "air-quality", "message": str(exc)})

        result["summary"] = self._summarize(result)
        return result

    # ------------------------------------------------------------------ #
    # Human-friendly summary
    # ------------------------------------------------------------------ #
    @staticmethod
    def _summarize(result: Dict[str, Any]) -> Dict[str, Any]:
        """Pull out the most commonly-needed 'at a glance' values."""
        summary: Dict[str, Any] = {}

        weather = result.get("weather") or {}
        current = weather.get("current") or {}
        if current:
            summary["temperature_c"] = current.get("temperature_2m")
            summary["feels_like_c"] = current.get("apparent_temperature")
            summary["humidity_pct"] = current.get("relative_humidity_2m")
            summary["wind_speed_kmh"] = current.get("wind_speed_10m")
            summary["wind_direction_deg"] = current.get("wind_direction_10m")
            summary["wind_gusts_kmh"] = current.get("wind_gusts_10m")
            summary["precipitation_mm"] = current.get("precipitation")
            summary["cloud_cover_pct"] = current.get("cloud_cover")
            summary["uv_index"] = current.get("uv_index")
        summary["elevation_m"] = weather.get("elevation")
        summary["timezone"] = weather.get("timezone")

        aq = result.get("air_quality") or {}
        aq_current = aq.get("current") or {}
        if aq_current:
            summary["european_aqi"] = aq_current.get("european_aqi")
            summary["us_aqi"] = aq_current.get("us_aqi")
            summary["pm2_5"] = aq_current.get("pm2_5")
            summary["pm10"] = aq_current.get("pm10")
            pollen = {v: aq_current.get(v) for v in POLLEN_VARS}
            # Only include pollen block if at least one value is non-null
            if any(v is not None for v in pollen.values()):
                summary["pollen_grains_per_m3"] = pollen
                summary["dominant_pollen"] = max(
                    (kv for kv in pollen.items() if kv[1] is not None),
                    key=lambda kv: kv[1],
                    default=(None, None),
                )[0]
            else:
                summary["pollen_grains_per_m3"] = None
                summary["dominant_pollen"] = None

        return summary


# ---------------------------------------------------------------------- #
# Convenience module-level function (no need to instantiate the class)
# ---------------------------------------------------------------------- #
_default_client: Optional[OpenMeteoClient] = None


def get_environmental_data(lat: float, lon: float, forecast_days: int = 7, timezone: str = "auto") -> Dict[str, Any]:
    global _default_client
    if _default_client is None:
        _default_client = OpenMeteoClient()
    return _default_client.get_environmental_data(lat, lon, forecast_days=forecast_days, timezone=timezone)


if __name__ == "__main__":
    import json
    import sys

    logging.basicConfig(level=logging.INFO)

    # Example: Berlin (inside CAMS European pollen domain)
    lat, lon = 30.76, 76.5775
    if len(sys.argv) == 3:
        lat, lon = float(sys.argv[1]), float(sys.argv[2])

    data = get_environmental_data(lat, lon)
    print(json.dumps(data["summary"], indent=2, default=str))
    if data["errors"]:
        print("\nErrors:", json.dumps(data["errors"], indent=2))