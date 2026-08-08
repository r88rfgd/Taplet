# [DATA INTEGRATION LAYER]: GBIF API Connection
# Dynamically queries the live Global Biodiversity Information Facility dataset
# to retrieve real-time, locally recorded plant and pollen occurrences based on
# the user's dynamic GPS coordinates.

from __future__ import annotations

import logging
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

logger = logging.getLogger("gbif_client")

OCCURRENCE_SEARCH_URL = "https://api.gbif.org/v1/occurrence/search"
SPECIES_MATCH_URL = "https://api.gbif.org/v1/species/match"

DEFAULT_TIMEOUT = 20  # seconds
PAGE_SIZE = 300  # GBIF's max page size for occurrence search

# Well-known, stable GBIF backbone taxonomy key for kingdom Plantae.
# (Kept as a constant to avoid an extra network round trip on every call;
#  `resolve_kingdom_key()` below can re-derive it if GBIF ever changes it.)
PLANTAE_KINGDOM_KEY = 6


def _build_session(total_retries: int = 4, backoff_factor: float = 0.6) -> requests.Session:
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
class GBIFClient:
    """Client for restricting a plant search space to locally-recorded species."""

    session: requests.Session = field(default_factory=_build_session)
    timeout: int = DEFAULT_TIMEOUT

    # ------------------------------------------------------------------ #
    # Low-level helpers
    # ------------------------------------------------------------------ #
    def _get(self, url: str, params: Dict[str, Any]) -> Dict[str, Any]:
        response = self.session.get(url, params=params, timeout=self.timeout)
        if response.status_code != 200:
            raise RuntimeError(f"HTTP {response.status_code} from {url}: {response.text[:300]}")
        return response.json()

    def resolve_kingdom_key(self, name: str = "Plantae") -> Optional[int]:
        """Look up a taxon's backbone key by name (fallback if the constant ever changes)."""
        try:
            data = self._get(SPECIES_MATCH_URL, {"name": name, "rank": "KINGDOM"})
            return data.get("usageKey")
        except Exception as exc:  # noqa: BLE001
            logger.warning("Could not resolve kingdom key for %s: %s", name, exc)
            return None

    # ------------------------------------------------------------------ #
    # Occurrence search (paginated)
    # ------------------------------------------------------------------ #
    def search_occurrences(
        self,
        lat: float,
        lon: float,
        radius_km: float = 25,
        kingdom_key: int = PLANTAE_KINGDOM_KEY,
        max_records: int = 1500,
        year_from: Optional[int] = None,
        extra_params: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Fetch raw occurrence records within `radius_km` of (lat, lon).

        Returns {"records": [...], "total_available": int, "errors": [...]}.
        """
        records: List[Dict[str, Any]] = []
        errors: List[Dict[str, str]] = []
        offset = 0
        total_available = 0

        base_params: Dict[str, Any] = {
            "kingdomKey": kingdom_key,
            "geoDistance": f"{lat},{lon},{radius_km}km",
            "hasCoordinate": "true",
            "hasGeospatialIssue": "false",
            "limit": min(PAGE_SIZE, max_records),
        }
        if year_from:
            base_params["year"] = f"{year_from},{9999}"
        if extra_params:
            base_params.update(extra_params)

        while len(records) < max_records:
            params = dict(base_params)
            params["offset"] = offset
            params["limit"] = min(PAGE_SIZE, max_records - len(records))
            try:
                page = self._get(OCCURRENCE_SEARCH_URL, params)
            except Exception as exc:  # noqa: BLE001
                errors.append({"offset": str(offset), "message": str(exc)})
                break

            total_available = page.get("count", total_available)
            results = page.get("results", [])
            records.extend(results)

            if page.get("endOfRecords", True) or not results:
                break
            offset += len(results)

        return {"records": records, "total_available": total_available, "errors": errors}

    # ------------------------------------------------------------------ #
    # Aggregate into a clean species list
    # ------------------------------------------------------------------ #
    @staticmethod
    def _aggregate_species(records: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        species: Dict[int, Dict[str, Any]] = {}

        for rec in records:
            taxon_key = rec.get("speciesKey") or rec.get("taxonKey") or rec.get("acceptedTaxonKey")
            if taxon_key is None:
                continue  # e.g. identified only to genus/family level

            entry = species.setdefault(
                taxon_key,
                {
                    "taxon_key": taxon_key,
                    "scientific_name": rec.get("species") or rec.get("scientificName"),
                    "vernacular_name": rec.get("vernacularName"),
                    "family": rec.get("family"),
                    "genus": rec.get("genus"),
                    "occurrence_count": 0,
                    "basis_of_record": set(),
                    "last_observed": None,
                    "iucn_status": rec.get("iucnRedListCategory"),
                },
            )
            entry["occurrence_count"] += 1
            if rec.get("basisOfRecord"):
                entry["basis_of_record"].add(rec["basisOfRecord"])
            event_date = rec.get("eventDate")
            if event_date and (entry["last_observed"] is None or event_date > entry["last_observed"]):
                entry["last_observed"] = event_date

        cleaned = []
        for entry in species.values():
            entry["basis_of_record"] = sorted(entry["basis_of_record"])
            cleaned.append(entry)

        cleaned.sort(key=lambda e: e["occurrence_count"], reverse=True)
        return cleaned

    # ------------------------------------------------------------------ #
    # Consolidated call
    # ------------------------------------------------------------------ #
    def get_local_plant_species(
        self,
        lat: float,
        lon: float,
        radius_km: float = 25,
        max_records: int = 1500,
        year_from: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Return locally-recorded plant species near (lat, lon).

        `radius_km` trades off specificity vs. coverage: dense urban areas
        may need only 5-10km, sparse/rural regions may need 50km+ to get
        a meaningful sample.
        """
        raw = self.search_occurrences(
            lat, lon, radius_km=radius_km, max_records=max_records, year_from=year_from
        )
        species_list = self._aggregate_species(raw["records"])

        families: Dict[str, int] = defaultdict(int)
        for sp in species_list:
            if sp["family"]:
                families[sp["family"]] += 1

        return {
            "request": {"latitude": lat, "longitude": lon, "radius_km": radius_km},
            "total_occurrences_available": raw["total_available"],
            "occurrences_fetched": len(raw["records"]),
            "unique_species_count": len(species_list),
            "species": species_list,
            "top_families": sorted(families.items(), key=lambda kv: kv[1], reverse=True)[:15],
            "errors": raw["errors"],
        }


# ---------------------------------------------------------------------- #
# Convenience module-level function
# ---------------------------------------------------------------------- #
_default_client: Optional[GBIFClient] = None


def get_local_plant_species(
    lat: float, lon: float, radius_km: float = 25, max_records: int = 1500
) -> Dict[str, Any]:
    global _default_client
    if _default_client is None:
        _default_client = GBIFClient()
    return _default_client.get_local_plant_species(lat, lon, radius_km=radius_km, max_records=max_records)


# ---------------------------------------------------------------------- #
# Full region profile: combines GBIF (this file) + Open-Meteo (weather/
# air-quality/pollen client) into one "everything about this place" report.
# ---------------------------------------------------------------------- #
def get_full_region_profile(
    lat: float,
    lon: float,
    radius_km: float = 25,
    forecast_days: int = 7,
) -> Dict[str, Any]:
    """One-stop function: local flora (GBIF) + weather/air-quality/pollen (Open-Meteo).

    Import is done lazily so gbif_client.py has no hard dependency on
    open_meteo_client.py unless this function is actually called.
    """
    from open_meteo_client import get_environmental_data  # sibling module

    plants = get_local_plant_species(lat, lon, radius_km=radius_km)
    environment = get_environmental_data(lat, lon, forecast_days=forecast_days)

    return {
        "location": {"latitude": lat, "longitude": lon},
        "plants": plants,
        "environment": environment,
    }


if __name__ == "__main__":
    import json
    import sys

    logging.basicConfig(level=logging.INFO)

    # Example: Berlin
    lat, lon = 30.76, 76.5775
    radius = 25
    if len(sys.argv) >= 3:
        lat, lon = float(sys.argv[1]), float(sys.argv[2])
    if len(sys.argv) >= 4:
        radius = float(sys.argv[3])

    result = get_local_plant_species(lat, lon, radius_km=radius)
    print(f"Found {result['unique_species_count']} unique plant species "
          f"within {radius}km of ({lat}, {lon})")
    print("Top families:", result["top_families"][:5])
    print("Top 10 species by occurrence count:")
    for sp in result["species"][:10]:
        print(f"  - {sp['scientific_name']} ({sp['vernacular_name']}) "
              f"[{sp['family']}] x{sp['occurrence_count']}")

    if result["errors"]:
        print("\nErrors:", json.dumps(result["errors"], indent=2))

    # Uncomment to get the fully combined weather + pollen + plants report:
    # profile = get_full_region_profile(lat, lon, radius_km=radius)
    # print(json.dumps(profile, indent=2, default=str))