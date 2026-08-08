# [DATA INTEGRATION LAYER]: Mapillary Graph API Connection
    # Connects the project to Meta's live Mapillary database to dynamically 
    # update the application with recent street-level imagery, bounding boxes, 
    # and map coverage vectors for the requested location.

import requests
import math
import json
import os
import cv2
import shutil
from typing import List, Dict, Tuple
from urllib.parse import urlparse
import datetime

class MapillaryPhotosFinder:
    def __init__(self, access_token: str):
        """
        Initialize the Mapillary Photos Finder
        Args:
            access_token (str): Your Mapillary API access token
        """
        self.access_token = access_token
        self.base_url = "https://graph.mapillary.com"

    def calculate_bounding_box(self, lat: float, lon: float, radius_meters: int = 50) -> Tuple[float, float, float, float]:
        earth_radius = 6371000
        lat_delta = (radius_meters / earth_radius) * (180 / math.pi)
        lon_delta = (radius_meters / earth_radius) * (180 / math.pi) / math.cos(math.radians(lat))

        min_lat = lat - lat_delta
        max_lat = lat + lat_delta
        min_lon = lon - lon_delta
        max_lon = lon + lon_delta

        return min_lon, min_lat, max_lon, max_lat

    def get_images_around_location(self, lat: float, lon: float, radius_meters: int = 50, exclude_panoramas: bool = True) -> List[Dict]:
        min_lon, min_lat, max_lon, max_lat = self.calculate_bounding_box(lat, lon, radius_meters)
        url = f"{self.base_url}/images"

        params = {
            'access_token': self.access_token,
            'bbox': f"{min_lon},{min_lat},{max_lon},{max_lat}",
            'fields': 'id,geometry,computed_geometry,captured_at,compass_angle,thumb_256_url,thumb_1024_url,thumb_2048_url,sequence_id,creator,is_pano',
            'limit': 2000
        }

        try:
            response = requests.get(url, params=params)
            response.raise_for_status()

            data = response.json()
            images = data.get('data', [])

            filtered_images = []
            for image in images:
                if exclude_panoramas and image.get('is_pano', False):
                    continue

                coords = image.get('computed_geometry') or image.get('geometry')
                if coords and coords.get('coordinates'):
                    img_lon, img_lat = coords['coordinates']
                    distance = self.calculate_distance(lat, lon, img_lat, img_lon)

                    if distance <= radius_meters:
                        image['distance_meters'] = round(distance, 2)
                        image['target_lat'] = lat
                        image['target_lon'] = lon
                        filtered_images.append(image)

            filtered_images.sort(key=lambda x: x['distance_meters'])
            return filtered_images

        except requests.exceptions.RequestException as e:
            print(f"Error making API request: {e}")
            return []
        except json.JSONDecodeError as e:
            print(f"Error parsing JSON response: {e}")
            return []

    def calculate_distance(self, lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        lat1, lon1, lat2, lon2 = map(math.radians, [lat1, lon1, lat2, lon2])
        dlat = lat2 - lat1
        dlon = lon2 - lon1
        a = math.sin(dlat/2)**2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon/2)**2
        c = 2 * math.asin(math.sqrt(a))
        return c * 6371000

    def get_coverage_points(self, lat: float, lon: float, radius_meters: int = 500) -> List[Dict]:
        """
        Return Mapillary coverage as a list of point coordinates (lat/lon) plus
        sequence polylines within a bounding box around the target. Mirrors the
        green "coverage" layer shown in the Mapillary web map.
        """
        min_lon, min_lat, max_lon, max_lat = self.calculate_bounding_box(lat, lon, radius_meters)
        url = f"{self.base_url}/images"

        params = {
            'access_token': self.access_token,
            'bbox': f"{min_lon},{min_lat},{max_lon},{max_lat}",
            'fields': 'id,geometry,computed_geometry,sequence_id,is_pano',
            'limit': 2000,
        }

        points = []
        sequences = {}
        try:
            response = requests.get(url, params=params)
            response.raise_for_status()
            for image in response.json().get('data', []):
                coords = image.get('computed_geometry') or image.get('geometry')
                if not coords or not coords.get('coordinates'):
                    continue
                img_lon, img_lat = coords['coordinates']
                if image.get('is_pano'):
                    continue
                points.append({'lat': img_lat, 'lon': img_lon})
                sid = image.get('sequence_id')
                if sid:
                    sequences.setdefault(sid, []).append({'lat': img_lat, 'lon': img_lon})
            # Sort each sequence's points by longitude so the polyline looks continuous
            seq_lines = []
            for sid, pts in sequences.items():
                pts.sort(key=lambda p: (p['lat'], p['lon']))
                seq_lines.append(pts)
            return {'points': points, 'sequences': seq_lines}
        except Exception as e:
            print(f"⚠️ Coverage fetch error: {e}")
            return {'points': [], 'sequences': []}

    def is_blurry(self, image_path: str, threshold: float = 100.0) -> Tuple[bool, float]:
        try:
            image = cv2.imread(image_path, cv2.IMREAD_GRAYSCALE)
            if image is None:
                return True, 0.0
            laplacian_var = cv2.Laplacian(image, cv2.CV_64F).var()
            return laplacian_var < threshold, laplacian_var
        except Exception:
            return True, 0.0

    def download_and_sort_images(self, images: List[Dict], folder_name: str = "mapillary_images", blur_threshold: float = 100.0) -> Dict[str, int]:
        if not images:
            return {'total': 0, 'clear': 0, 'blurry': 0, 'failed': 0}

        if not os.path.exists(folder_name):
            os.makedirs(folder_name)

        clear_folder = os.path.join(folder_name, "clear")
        blurry_folder = os.path.join(folder_name, "blurry")

        for subfolder in [clear_folder, blurry_folder]:
            if not os.path.exists(subfolder):
                os.makedirs(subfolder)

        stats = {'total': len(images), 'clear': 0, 'blurry': 0, 'failed': 0}
        temp_folder = os.path.join(folder_name, "temp")

        if not os.path.exists(temp_folder):
            os.makedirs(temp_folder)

        print(f"\n🔍 Starting download and blur analysis with threshold: {blur_threshold}")
        
        for i, image in enumerate(images, 1):
            try:
                coords = image.get('computed_geometry') or image.get('geometry')
                if not coords or not coords.get('coordinates'):
                    stats['failed'] += 1
                    continue

                img_lon, img_lat = coords['coordinates']
                lat_str = f"{img_lat:.6f}".replace('.', '_').replace('-', 'neg')
                lon_str = f"{img_lon:.6f}".replace('.', '_').replace('-', 'neg')

                image_urls = [image.get('thumb_2048_url'), image.get('thumb_1024_url'), image.get('thumb_256_url')]
                downloaded = False
                temp_filepath = None

                for url in image_urls:
                    if url:
                        try:
                            parsed_url = urlparse(url)
                            file_ext = '.' + parsed_url.path.split('.')[-1] if '.' in parsed_url.path else '.jpg'
                            filename = f"lat_{lat_str}_lon_{lon_str}_{image.get('id')}{file_ext}"
                            temp_filepath = os.path.join(temp_folder, filename)

                            print(f"⬇️  Downloading {i}/{len(images)}: {filename}")
                            img_response = requests.get(url, stream=True, timeout=30)
                            img_response.raise_for_status()

                            with open(temp_filepath, 'wb') as f:
                                for chunk in img_response.iter_content(chunk_size=8192):
                                    f.write(chunk)

                            downloaded = True
                            break
                        except requests.exceptions.RequestException:
                            continue

                if not downloaded:
                    stats['failed'] += 1
                    continue

                is_blurry, laplacian_var = self.is_blurry(temp_filepath, blur_threshold)

                if is_blurry:
                    final_path = os.path.join(blurry_folder, os.path.basename(temp_filepath))
                    stats['blurry'] += 1
                else:
                    final_path = os.path.join(clear_folder, os.path.basename(temp_filepath))
                    stats['clear'] += 1

                shutil.move(temp_filepath, final_path)

            except Exception:
                stats['failed'] += 1
                continue

        try:
            os.rmdir(temp_folder)
        except:
            pass

        print(f"\n🎉 Download and sorting complete! Success rate: {((stats['clear'] + stats['blurry']) / stats['total'] * 100):.1f}%")
        return stats
