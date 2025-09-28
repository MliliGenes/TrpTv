import json
import requests
from bs4 import BeautifulSoup
import time
import logging
import re
from urllib.parse import urljoin, parse_qs, urlparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading
from queue import Queue

# -----------------------------
# Logging Setup
# -----------------------------
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler("scraper.log"),
        logging.StreamHandler()
    ]
)

# -----------------------------
# Constants
# -----------------------------
BASE_URL = "https://stevenuniverse.best"
OUTPUT_FILE = "cartoons_data.json"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
}

# -----------------------------
# Utility Functions
# -----------------------------
def get_soup(url, retries=3, delay=1):
    """Fetch a URL and return BeautifulSoup object with retries."""
    for attempt in range(retries):
        try:
            logging.info(f"Fetching: {url}")
            r = requests.get(url, headers=HEADERS)
            r.raise_for_status()
            return BeautifulSoup(r.text, "html.parser")
        except requests.exceptions.RequestException as e:
            logging.warning(f"Error fetching {url}: {e}")
            if attempt < retries - 1:
                time.sleep(delay)
                delay *= 2
            else:
                logging.error(f"Failed to fetch {url} after {retries} attempts")
                return None

def parse_video_url(video_url):
    """Parse video URL to extract show ID, season, and episode number"""
    try:
        parsed_url = urlparse(video_url)
        query_params = parse_qs(parsed_url.query)
        
        # Extract parameters from URL like: /video-player/?idd=60306&season=1&episode=1
        show_id = query_params.get('idd', [None])[0]
        season = query_params.get('season', [None])[0]
        episode = query_params.get('episode', [None])[0]
        
        return {
            'show_id': show_id,
            'season': season,
            'episode': episode
        }
    except Exception as e:
        logging.warning(f"Error parsing video URL {video_url}: {e}")
        return None

def get_stream_url(idd, season, episode, timeout=10):
    """Extract streaming URL from video player page - based on watch.js logic"""
    base_url = f"{BASE_URL}/video-player/?idd={idd}&season={season}&episode={episode}"
    referer = BASE_URL
    
    try:
        # Fetch video page
        response = requests.get(base_url, headers={
            **HEADERS,
            "Referer": referer
        }, timeout=timeout)
        response.raise_for_status()
        
        soup = BeautifulSoup(response.text, "html.parser")
        watch_url = None
        
        # Extract watch URL from iframes, scripts, and links
        for element in soup.find_all(["iframe", "script", "a"]):
            attr_value = None
            if element.name == "iframe":
                attr_value = element.get("src")
            elif element.name == "script":
                attr_value = element.string
            elif element.name == "a":
                attr_value = element.get("href")
            
            if attr_value and "123moviespremium.net/watch/" in str(attr_value):
                watch_url = str(attr_value).replace("&amp;", "&")
                break
        
        if not watch_url:
            logging.warning(f"No watch URL found for S{season}E{episode} (ID: {idd})")
            return None
        
        # Fetch playlist or direct stream
        stream_response = requests.get(watch_url, headers={
            "User-Agent": HEADERS["User-Agent"],
            "Referer": referer
        }, timeout=timeout)
        stream_response.raise_for_status()
        
        content_type = stream_response.headers.get("content-type", "")
        
        if "mpegurl" in content_type.lower():
            # Parse M3U8 playlist
            playlist = stream_response.text
            lines = playlist.split("\n")
            for line in lines:
                line = line.strip()
                if line and not line.startswith("#"):
                    return line
            return watch_url
        else:
            return watch_url
    
    except Exception as e:
        logging.warning(f"Failed to get stream URL for S{season}E{episode} (ID: {idd}): {e}")
        return None

def extract_tmdb_data(show_url):
    """Extract TMDb ID and API key from show page"""
    soup = get_soup(show_url)
    
    if not soup:
        return None, None, []
    
    content = str(soup)
    
    # Extract API key and ID using regex
    api_key_pattern = r'const apiKey = ["\']([^"\']+)["\']'
    id_pattern = r'const id = ["\']?(\d+)["\']?'
    
    api_key_match = re.search(api_key_pattern, content)
    id_match = re.search(id_pattern, content)
    
    api_key = api_key_match.group(1) if api_key_match else None
    tmdb_id = id_match.group(1) if id_match else None
    
    # Get season numbers from the dropdown
    season_numbers = []
    season_select = soup.select_one("#season-select")
    if season_select:
        season_options = season_select.select("option")
        for option in season_options:
            try:
                season_num = int(option.get('value'))
                season_numbers.append(season_num)
            except (ValueError, TypeError):
                continue
    
    return api_key, tmdb_id, season_numbers

def get_episodes_from_tmdb_api(api_key, tmdb_id, season_number):
    """Get episodes from TMDb API"""
    try:
        url = f"https://api.themoviedb.org/3/tv/{tmdb_id}/season/{season_number}?api_key={api_key}"
        response = requests.get(url, headers=HEADERS)
        
        if response.status_code == 200:
            data = response.json()
            episodes = []
            
            for ep_data in data.get('episodes', []):
                episode_id = ep_data.get('episode_number', '')
                episode = {
                    "number": f"Episode {episode_id}",
                    "title": ep_data.get('name', ''),
                    "description": ep_data.get('overview', ''),
                    "image": f"https://image.tmdb.org/t/p/w500{ep_data.get('still_path', '')}" if ep_data.get('still_path') else "",
                    "link": f"{BASE_URL}/video-player/?idd={tmdb_id}&season={season_number}&episode={episode_id}",
                    "show_id": tmdb_id,
                    "season_id": season_number,
                    "episode_id": episode_id,
                    "play_url": None  # Will be populated by get_episode_stream_urls
                }
                episodes.append(episode)
            
            return episodes
        else:
            logging.warning(f"TMDb API error for TV {tmdb_id} Season {season_number}: {response.status_code}")
            return []
            
    except Exception as e:
        logging.error(f"Error fetching episodes from TMDb for TV {tmdb_id} Season {season_number}: {e}")
        return []

def get_episode_stream_urls(episodes, show_title, max_workers=5):
    """Get streaming URLs for episodes using multi-threading"""
    def fetch_stream_url(episode):
        """Fetch stream URL for a single episode"""
        try:
            stream_url = get_stream_url(
                episode['show_id'],
                episode['season_id'], 
                episode['episode_id']
            )
            episode['play_url'] = stream_url
            if stream_url:
                logging.info(f"  ✓ S{episode['season_id']}E{episode['episode_id']} - {episode['title'][:30]}...")
            else:
                logging.warning(f"  ✗ S{episode['season_id']}E{episode['episode_id']} - Failed to get stream URL")
            return episode
        except Exception as e:
            logging.error(f"Error getting stream URL for S{episode['season_id']}E{episode['episode_id']}: {e}")
            episode['play_url'] = None
            return episode
    
    if not episodes:
        return episodes
    
    logging.info(f"  Getting stream URLs for {len(episodes)} episodes using {max_workers} threads...")
    
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        # Submit all tasks
        future_to_episode = {executor.submit(fetch_stream_url, episode): episode for episode in episodes}
        
        # Process completed tasks
        updated_episodes = []
        for future in as_completed(future_to_episode):
            try:
                updated_episode = future.result()
                updated_episodes.append(updated_episode)
            except Exception as e:
                episode = future_to_episode[future]
                logging.error(f"Thread error for S{episode['season_id']}E{episode['episode_id']}: {e}")
                episode['play_url'] = None
                updated_episodes.append(episode)
    
    # Sort episodes back to original order
    updated_episodes.sort(key=lambda ep: ep['episode_id'])
    
    success_count = sum(1 for ep in updated_episodes if ep['play_url'])
    logging.info(f"  ✓ Successfully got {success_count}/{len(episodes)} stream URLs")
    
    return updated_episodes

def get_all_episodes_for_show(show_url, include_stream_urls=False):
    """Get all episodes for all seasons of a show using TMDb API"""
    
    # Extract TMDb data from the show page
    api_key, tmdb_id, season_numbers = extract_tmdb_data(show_url)
    
    if not api_key or not tmdb_id:
        logging.warning(f"Could not extract TMDb data for {show_url}")
        return {}
    
    logging.info(f"Found TMDb ID {tmdb_id} with {len(season_numbers)} seasons")
    
    seasons_data = {}
    
    # Fetch episodes for each season
    for season_number in season_numbers:
        episodes = get_episodes_from_tmdb_api(api_key, tmdb_id, season_number)
        
        # Get streaming URLs if requested
        if include_stream_urls and episodes:
            episodes = get_episode_stream_urls(episodes, f"Season {season_number}")
        
        seasons_data[season_number] = episodes
        logging.info(f"  Season {season_number}: {len(episodes)} episodes")
        
        # Be gentle with the API
        time.sleep(0.3)
    
    return seasons_data

def load_existing_data():
    """Load existing cartoon data from JSON file"""
    try:
        with open(OUTPUT_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return data.get('cartoons', [])
    except FileNotFoundError:
        logging.error(f"File {OUTPUT_FILE} not found!")
        return []
    except Exception as e:
        logging.error(f"Error loading data: {e}")
        return []

def save_data(cartoons):
    """Save cartoon data to JSON file"""
    try:
        with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
            json.dump({"cartoons": cartoons}, f, indent=2, ensure_ascii=False)
        logging.info(f"Data saved to {OUTPUT_FILE}")
    except Exception as e:
        logging.error(f"Error saving data: {e}")

def process_single_show(cartoon_data):
    """Process a single cartoon show - used for threading"""
    i, cartoon, include_stream_urls = cartoon_data
    
    try:
        logging.info(f"Processing {i+1}: {cartoon['title']}")
        
        # Get all episodes for this show
        seasons_episodes = get_all_episodes_for_show(cartoon['url'], include_stream_urls)
        
        # Update each season with its episodes
        for season in cartoon.get('seasons', []):
            season_number = season['season_number']
            episodes = seasons_episodes.get(season_number, [])
            season['episodes'] = episodes
            logging.info(f"  Found {len(episodes)} episodes for season {season_number}")
        
        return True, cartoon
        
    except Exception as e:
        logging.error(f"Error processing {cartoon['title']}: {e}")
        return False, cartoon

def scrape_episodes_for_all_shows(include_stream_urls=False, max_workers=3):
    """Main function to scrape episodes for all shows with multi-threading"""
    logging.info("Starting episode scraping for all shows")
    logging.info(f"Stream URLs: {'Enabled' if include_stream_urls else 'Disabled'}")
    logging.info(f"Max workers: {max_workers}")
    
    # Load existing show data
    cartoons = load_existing_data()
    
    if not cartoons:
        logging.error("No cartoon data found to process")
        return
    
    logging.info(f"Found {len(cartoons)} cartoons to process")
    
    # Prepare data for threading
    cartoon_tasks = [(i, cartoon, include_stream_urls) for i, cartoon in enumerate(cartoons)]
    processed_cartoons = []
    
    if max_workers == 1:
        # Sequential processing
        for task in cartoon_tasks:
            success, cartoon = process_single_show(task)
            processed_cartoons.append(cartoon)
            
            # Save progress every 10 shows
            if (len(processed_cartoons)) % 10 == 0:
                save_data(processed_cartoons)
                logging.info(f"Progress saved: {len(processed_cartoons)}/{len(cartoons)} shows processed")
    else:
        # Multi-threaded processing
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            # Submit all tasks
            future_to_cartoon = {executor.submit(process_single_show, task): task for task in cartoon_tasks}
            
            # Process completed tasks
            for future in as_completed(future_to_cartoon):
                try:
                    success, cartoon = future.result()
                    processed_cartoons.append(cartoon)
                    
                    # Save progress every 10 shows
                    if len(processed_cartoons) % 10 == 0:
                        # Sort by original order before saving
                        processed_cartoons.sort(key=lambda c: next(i for i, orig in enumerate(cartoons) if orig['title'] == c['title']))
                        save_data(processed_cartoons + cartoons[len(processed_cartoons):])
                        logging.info(f"Progress saved: {len(processed_cartoons)}/{len(cartoons)} shows processed")
                        
                except Exception as e:
                    task = future_to_cartoon[future]
                    logging.error(f"Thread error for {task[1]['title']}: {e}")
    
    # Sort final results and save
    processed_cartoons.sort(key=lambda c: next(i for i, orig in enumerate(cartoons) if orig['title'] == c['title']))
    save_data(processed_cartoons)
    
    # Print summary
    total_episodes = sum(
        len(season.get("episodes", [])) 
        for cartoon in processed_cartoons 
        for season in cartoon.get("seasons", [])
    )
    
    episodes_with_streams = sum(
        len([ep for ep in season.get("episodes", []) if ep.get('play_url')])
        for cartoon in processed_cartoons 
        for season in cartoon.get("seasons", [])
    )
    
    logging.info(f"Episode scraping complete!")
    logging.info(f"Total shows: {len(processed_cartoons)}")
    logging.info(f"Total episodes found: {total_episodes}")
    if include_stream_urls:
        logging.info(f"Episodes with stream URLs: {episodes_with_streams}/{total_episodes}")

if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Scrape cartoon episodes with optional streaming URLs")
    parser.add_argument("--streams", action="store_true", help="Also extract streaming URLs (slower)")
    parser.add_argument("--workers", type=int, default=3, help="Number of concurrent workers (default: 3)")
    parser.add_argument("--no-threads", action="store_true", help="Disable threading (sequential processing)")
    
    args = parser.parse_args()
    
    workers = 1 if args.no_threads else args.workers
    
    logging.info(f"Starting scraper with {workers} worker(s)")
    if args.streams:
        logging.info("Stream URL extraction enabled - this will be slower but more complete")
    
    scrape_episodes_for_all_shows(
        include_stream_urls=args.streams,
        max_workers=workers
    )