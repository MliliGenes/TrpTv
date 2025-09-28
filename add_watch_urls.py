#!/usr/bin/env python3
"""
Add watch_url fields to cartoons JSON data
Uses the same logic as the JavaScript getStreamUrl function
"""

import json
import requests
from bs4 import BeautifulSoup
import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
import argparse
from urllib.parse import urljoin

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler("watch_urls.log"),
        logging.StreamHandler()
    ]
)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
}

BASE_URL = "https://stevenuniverse.best"
REFERER = "https://stevenuniverse.best"

def get_watch_url(idd, season, episode, timeout=15):
    """
    Extract watch URL using the same logic as JavaScript getStreamUrl function
    """
    base_url = f"{BASE_URL}/video-player/?idd={idd}&season={season}&episode={episode}"
    
    try:
        # Step 1: Fetch video page (like the JavaScript version)
        response = requests.get(base_url, headers=HEADERS, timeout=timeout)
        response.raise_for_status()
        
        # Step 2: Extract watch URL from HTML (mimic cheerio logic)
        soup = BeautifulSoup(response.text, 'html.parser')
        watch_url = None
        
        # Check iframes, scripts, and links for 123moviespremium.net/watch/
        elements_to_check = (
            soup.find_all('iframe') + 
            soup.find_all('script') + 
            soup.find_all('a')
        )
        
        for element in elements_to_check:
            attr_value = None
            
            # Get appropriate attribute based on element type
            if element.name == 'iframe':
                attr_value = element.get('src')
            elif element.name == 'script':
                attr_value = element.string or element.get_text()
            elif element.name == 'a':
                attr_value = element.get('href')
            
            # Check if this contains the watch URL
            if attr_value and '123moviespremium.net/watch/' in str(attr_value):
                watch_url = str(attr_value).replace('&amp;', '&')
                break
        
        if not watch_url:
            logging.warning(f"No watch URL found for S{season}E{episode} (ID: {idd})")
            return None
        
        # Step 3: Fetch playlist or direct stream (like JavaScript version)
        stream_response = requests.get(watch_url, headers={
            "User-Agent": HEADERS["User-Agent"],
            "Referer": REFERER
        }, timeout=timeout)
        stream_response.raise_for_status()
        
        content_type = stream_response.headers.get('content-type', '').lower()
        
        # Step 4: Handle M3U8 playlists (like JavaScript version)
        if 'mpegurl' in content_type:
            # Parse M3U8 playlist to find the actual stream URL
            playlist_text = stream_response.text
            lines = playlist_text.split('\n')
            
            # Find first non-comment line (like JavaScript version)
            for line in lines:
                line = line.strip()
                if line and not line.startswith('#'):
                    return line
            
            # Fallback to watch_url if no stream found
            return watch_url
        else:
            # Direct stream URL
            return watch_url
    
    except requests.exceptions.Timeout:
        logging.warning(f"Timeout getting watch URL for S{season}E{episode} (ID: {idd})")
        return None
    except requests.exceptions.RequestException as e:
        logging.warning(f"Request error for S{season}E{episode} (ID: {idd}): {e}")
        return None
    except Exception as e:
        logging.error(f"Unexpected error for S{season}E{episode} (ID: {idd}): {e}")
        return None

def process_episode(episode_data):
    """Process a single episode to add watch_url"""
    episode, show_title = episode_data
    
    try:
        show_id = episode.get('show_id')
        season_id = episode.get('season_id') 
        episode_id = episode.get('episode_id')
        
        if not all([show_id, season_id, episode_id]):
            logging.warning(f"Missing IDs for episode: {episode.get('title', 'Unknown')}")
            return episode
        
        # Get the watch URL
        watch_url = get_watch_url(show_id, season_id, episode_id)
        
        # Add watch_url field to episode
        episode['watch_url'] = watch_url
        
        if watch_url:
            logging.info(f"✓ {show_title} S{season_id}E{episode_id} - {episode.get('title', '')[:40]}...")
        else:
            logging.warning(f"✗ {show_title} S{season_id}E{episode_id} - Failed to get watch URL")
        
        return episode
        
    except Exception as e:
        logging.error(f"Error processing episode {episode.get('title', 'Unknown')}: {e}")
        episode['watch_url'] = None
        return episode

def add_watch_urls_to_json(input_file='cartoons_data.json', output_file=None, max_workers=5, limit_shows=None):
    """
    Add watch_url fields to all episodes in the JSON file
    """
    if output_file is None:
        output_file = input_file
    
    logging.info(f"Loading data from {input_file}")
    
    # Load existing data
    try:
        with open(input_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except Exception as e:
        logging.error(f"Error loading {input_file}: {e}")
        return
    
    cartoons = data.get('cartoons', [])
    
    if limit_shows:
        cartoons = cartoons[:limit_shows]
        logging.info(f"Processing only first {limit_shows} shows")
    
    logging.info(f"Found {len(cartoons)} cartoons to process")
    
    # Collect all episodes that need processing
    episodes_to_process = []
    total_episodes = 0
    
    for cartoon in cartoons:
        show_title = cartoon.get('title', 'Unknown')
        for season in cartoon.get('seasons', []):
            for episode in season.get('episodes', []):
                # Only process episodes that don't already have watch_url or have None
                if episode.get('watch_url') is None:
                    episodes_to_process.append((episode, show_title))
                total_episodes += 1
    
    logging.info(f"Total episodes: {total_episodes}")
    logging.info(f"Episodes needing watch URLs: {len(episodes_to_process)}")
    
    if not episodes_to_process:
        logging.info("All episodes already have watch URLs!")
        return
    
    # Process episodes with threading
    logging.info(f"Starting processing with {max_workers} workers...")
    
    processed_count = 0
    successful_count = 0
    
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        # Submit all tasks
        future_to_episode = {
            executor.submit(process_episode, episode_data): episode_data 
            for episode_data in episodes_to_process
        }
        
        # Process completed tasks
        for future in as_completed(future_to_episode):
            try:
                updated_episode = future.result()
                processed_count += 1
                
                if updated_episode.get('watch_url'):
                    successful_count += 1
                
                # Save progress every 50 episodes
                if processed_count % 50 == 0:
                    with open(output_file, 'w', encoding='utf-8') as f:
                        json.dump(data, f, indent=2, ensure_ascii=False)
                    logging.info(f"Progress saved: {processed_count}/{len(episodes_to_process)} episodes processed")
                
                # Rate limiting - be gentle with the server
                time.sleep(0.1)
                
            except Exception as e:
                logging.error(f"Thread execution error: {e}")
    
    # Final save
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    
    # Summary
    logging.info("="*60)
    logging.info("PROCESSING COMPLETE!")
    logging.info(f"Total episodes processed: {processed_count}")
    logging.info(f"Successfully got watch URLs: {successful_count}")
    logging.info(f"Failed to get watch URLs: {processed_count - successful_count}")
    logging.info(f"Success rate: {(successful_count/processed_count*100):.1f}%")
    logging.info(f"Output saved to: {output_file}")

def main():
    parser = argparse.ArgumentParser(description="Add watch_url fields to cartoon episodes JSON")
    parser.add_argument('--input', '-i', default='cartoons_data.json', 
                       help='Input JSON file (default: cartoons_data.json)')
    parser.add_argument('--output', '-o', 
                       help='Output JSON file (default: same as input)')
    parser.add_argument('--workers', '-w', type=int, default=5,
                       help='Number of concurrent workers (default: 5)')
    parser.add_argument('--limit', '-l', type=int,
                       help='Limit processing to first N shows (for testing)')
    parser.add_argument('--dry-run', action='store_true',
                       help='Show what would be processed without making changes')
    
    args = parser.parse_args()
    
    if args.dry_run:
        # Show statistics without processing
        try:
            with open(args.input, 'r', encoding='utf-8') as f:
                data = json.load(f)
            
            cartoons = data.get('cartoons', [])
            if args.limit:
                cartoons = cartoons[:args.limit]
            
            total_episodes = 0
            episodes_without_watch_url = 0
            episodes_with_watch_url = 0
            
            for cartoon in cartoons:
                for season in cartoon.get('seasons', []):
                    for episode in season.get('episodes', []):
                        total_episodes += 1
                        if episode.get('watch_url') is None:
                            episodes_without_watch_url += 1
                        else:
                            episodes_with_watch_url += 1
            
            print(f"📊 DRY RUN STATISTICS:")
            print(f"Shows to process: {len(cartoons)}")
            print(f"Total episodes: {total_episodes}")
            print(f"Episodes with watch_url: {episodes_with_watch_url}")
            print(f"Episodes needing watch_url: {episodes_without_watch_url}")
            print(f"Estimated processing time: {episodes_without_watch_url * 2 / args.workers / 60:.1f} minutes")
            
        except Exception as e:
            print(f"Error reading file: {e}")
    else:
        add_watch_urls_to_json(
            input_file=args.input,
            output_file=args.output,
            max_workers=args.workers,
            limit_shows=args.limit
        )

if __name__ == "__main__":
    main()