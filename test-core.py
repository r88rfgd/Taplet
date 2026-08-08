import unittest
import requests
import os

# Import the existing clients from your project
from gbif_client import GBIFClient
from open_meteo_client import get_environmental_data

class TestExternalServices(unittest.TestCase):

    def test_gbif_ping(self):
        """Test if the GBIF API is reachable and returning valid taxonomy data."""
        client = GBIFClient()
        # Plantae kingdom key should reliably resolve to 6
        key = client.resolve_kingdom_key("Plantae")
        self.assertEqual(key, 6, "GBIF API failed to resolve the Plantae kingdom key.")

    def test_open_meteo_ping(self):
        """Test if the Open-Meteo API is reachable and returning weather summaries."""
        # Using placeholder coordinates (London) with a minimal 1-day forecast
        data = get_environmental_data(51.5, -0.1, forecast_days=1)
        
        # Verify the API returned a summary and didn't log any internal errors
        self.assertIsNotNone(data.get("summary"), "Open-Meteo API failed to return a data summary.")
        self.assertFalse(data.get("errors"), f"Open-Meteo API returned errors: {data.get('errors')}")

    def test_ollama_ping(self):
        """Test if the Ollama server is running and reachable."""
        # Defaults to the standard localhost port if not set in the environment
        host = os.getenv("OLLAMA_HOST", "http://localhost:11434")
        
        try:
            # Ping the base version endpoint of the Ollama server
            response = requests.get(f"{host}/api/version", timeout=5)
            self.assertEqual(response.status_code, 200, f"Ollama returned an unexpected status: {response.status_code}")
        except requests.exceptions.ConnectionError:
            self.fail(f"Could not connect to Ollama server at {host}. Make sure the service is running.")
        except requests.exceptions.Timeout:
            self.fail(f"Connection to Ollama server at {host} timed out.")

if __name__ == "__main__":
    unittest.main()