#!/usr/bin/env node
/**
 * TrpTv - Simple TV Shows CLI Streamer
 * Simplified interface with Ctrl+S search and episode navigation
 */

import axios from "axios";
import * as cheerio from "cheerio";
import inquirer from "inquirer";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from 'url';
import { createInterface } from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// TV Shows cache
let metadataCache = null;
let currentSearchTerm = '';

// File paths
const METADATA_FILE = path.join(__dirname, 'cartoons_metadata.json');
const FULL_DATA_FILE = path.join(__dirname, 'cartoons_data.json');

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
};

/**
 * Load metadata file
 */
async function loadMetadata() {
  if (metadataCache) {
    return metadataCache;
  }
  
  try {
    if (!fs.existsSync(METADATA_FILE)) {
      console.log('❌ Metadata file not found. Run: node generate_metadata.js');
      process.exit(1);
    }

    console.log('📚 Loading TV shows...');
    const rawData = fs.readFileSync(METADATA_FILE, 'utf8');
    metadataCache = JSON.parse(rawData);
    
    if (!metadataCache.shows || !Array.isArray(metadataCache.shows)) {
      throw new Error('Invalid metadata format');
    }
    
    console.log(`✅ Loaded ${metadataCache.shows.length} shows`);
    return metadataCache;
    
  } catch (error) {
    console.error('❌ Error loading metadata:', error.message);
    process.exit(1);
  }
}

/**
 * Load full show data
 */
async function loadFullData(showTitle) {
  try {
    if (!fs.existsSync(FULL_DATA_FILE)) {
      throw new Error(`Full data file not found: ${FULL_DATA_FILE}`);
    }

    console.log(`🔍 Loading episodes for "${showTitle}"...`);
    const rawData = fs.readFileSync(FULL_DATA_FILE, 'utf8');
    const fullData = JSON.parse(rawData);
    
    const show = fullData.cartoons.find(s => s.title === showTitle);
    if (!show) {
      throw new Error(`Show "${showTitle}" not found`);
    }
    
    return show;
    
  } catch (error) {
    console.error('❌ Error loading show data:', error.message);
    throw error;
  }
}

/**
 * Search shows
 */
function searchShows(query) {
  if (!metadataCache || !metadataCache.shows) return [];
  
  if (!query || query.trim().length === 0) {
    return metadataCache.shows
      .sort((a, b) => a.title.localeCompare(b.title));
  }
  
  const searchTerm = query.toLowerCase().trim();
  return metadataCache.shows
    .filter(show => 
      show.title.toLowerCase().includes(searchTerm)
    )
    .sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * Extract stream URL
 */
async function getActualStreamUrl(idd, season, episode) {
  const baseUrl = `https://stevenuniverse.best/video-player/?idd=${idd}&season=${season}&episode=${episode}`;
  const referer = "https://stevenuniverse.best";

  try {
    console.log(`🔍 Getting stream URL for S${season}E${episode}...`);
    
    const { data: html } = await axios.get(baseUrl, {
      headers: { ...HEADERS, "Referer": referer },
      timeout: 20000
    });

    const $ = cheerio.load(html);
    let watchUrl = null;
    
    const streamingPatterns = [
      /123moviespremium\.net\/watch\//,
      /123movies\w*\.net\/watch\//,
      /movies123\..*\/watch\//,
      /fmovies\..*\/watch\//,
      /gomovies\..*\/watch\//,
      /gomovies-sx\.net\/embed\//,
      /putlocker\..*\/watch\//,
      /solarmovie\..*\/watch\//,
      /vidsrc\..*\/embed\//,
      /embed\..*\/.*\?.*=/,
      /player\..*\/.*\?.*=/
    ];
    
    const searchElements = ["iframe", "script", "a", "source", "video"];
    const searchAttributes = ["src", "href", "data-src", "data-url"];
    
    for (const element of searchElements) {
      $(element).each((_, el) => {
        for (const attr of searchAttributes) {
          const url = $(el).attr(attr);
          if (url && streamingPatterns.some(pattern => pattern.test(url))) {
            watchUrl = url.replace(/&amp;/g, "&");
            return false;
          }
        }
      });
      if (watchUrl) break;
    }

    if (!watchUrl) {
      console.warn(`⚠️  No stream URL found for S${season}E${episode}`);
      return null;
    }

    console.log(`✅ Found stream URL`);
    return watchUrl;

  } catch (error) {
    console.error(`❌ Error getting stream URL: ${error.message}`);
    return null;
  }
}

/**
 * Stream episode with navigation options
 */
async function streamEpisodeWithNavigation(show, season, episodeIndex) {
  const episode = season.episodes[episodeIndex];
  
  try {
    console.log(`🎬 Playing S${episode.season_id}E${episode.episode_id}: ${episode.title}`);
    
    const streamUrl = await getActualStreamUrl(
      episode.show_id, 
      episode.season_id, 
      episode.episode_id
    );
    
    if (!streamUrl) {
      console.log('❌ Could not get stream URL');
      return;
    }

    console.log('🎮 Starting mpv... (Q to quit, SPACE to pause/play)');
    const mpvProcess = spawn("mpv", [streamUrl], { stdio: "inherit" });

    await new Promise((resolve) => {
      mpvProcess.on("close", (code) => {
        resolve(code);
      });
    });

    // After episode ends, show navigation options
    const choices = [];
    
    // Previous episode
    if (episodeIndex > 0) {
      const prevEp = season.episodes[episodeIndex - 1];
      choices.push({
        name: `⬅️  Previous: S${prevEp.season_id}E${prevEp.episode_id} - ${prevEp.title}`,
        value: 'prev'
      });
    }
    
    // Next episode
    if (episodeIndex < season.episodes.length - 1) {
      const nextEp = season.episodes[episodeIndex + 1];
      choices.push({
        name: `➡️  Next: S${nextEp.season_id}E${nextEp.episode_id} - ${nextEp.title}`,
        value: 'next'
      });
    }
    
    choices.push(
      { name: '📺 Back to Episodes List', value: 'episodes' },
      { name: '📂 Back to Seasons List', value: 'seasons' },
      { name: '🏠 Back to Shows List', value: 'shows' },
      { name: '❌ Exit', value: 'exit' }
    );

    const answer = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'What would you like to do next?',
        choices: choices
      }
    ]);

    switch (answer.action) {
      case 'prev':
        return await streamEpisodeWithNavigation(show, season, episodeIndex - 1);
      case 'next':
        return await streamEpisodeWithNavigation(show, season, episodeIndex + 1);
      case 'episodes':
        return 'episodes';
      case 'seasons':
        return 'seasons';
      case 'shows':
        return 'shows';
      case 'exit':
        return 'exit';
    }

  } catch (error) {
    console.error('❌ Error streaming episode:', error.message);
    return 'episodes';
  }
}

/**
 * Show episodes list
 */
async function showEpisodesList(show, season) {
  while (true) {
    console.clear();
    console.log(`\n📺 ${show.title} - Season cc${season.season_number}`);
    console.log('═'.repeat(50));
    console.log(`${season.episodes.length} episodes available\n`);

    const choices = season.episodes.map((episode, index) => ({
      name: `E${episode.episode_id}: ${episode.title}`,
      value: index
    }));

    choices.push(
      new inquirer.Separator(),
      { name: '🔙 Back to Seasons', value: 'back' }
    );

    const answer = await inquirer.prompt([
      {
        type: 'list',
        name: 'episode',
        message: 'Select an episode:',
        choices: choices,
        pageSize: 15
      }
    ]);

    if (answer.episode === 'back') {
      return 'seasons';
    }

    const result = await streamEpisodeWithNavigation(show, season, answer.episode);
    
    // Handle navigation results
    if (result === 'episodes') {
      continue; // Stay in episodes list
    } else if (result === 'seasons') {
      return 'seasons'; // Go back to seasons
    } else if (result === 'shows') {
      return 'shows'; // Go back to shows
    } else if (result === 'exit') {
      return 'exit'; // Exit the app
    }
  }
}

/**
 * Show seasons list
 */
async function showSeasonsList(show, fullShow) {
  while (true) {
    console.clear();
    console.log(`\n📺 ${show.title}`);
    console.log('═'.repeat(30));
    console.log(`${fullShow.seasons.length} seasons available\n`);

    const availableSeasons = fullShow.seasons.filter(season => 
      season.episodes && season.episodes.length > 0
    );

    if (availableSeasons.length === 0) {
      console.log('❌ No episodes available for this show');
      return 'shows';
    }

    const choices = availableSeasons.map(season => ({
      name: `Season ${season.season_number} (${season.episodes.length} episodes)`,
      value: season
    }));

    choices.push(
      new inquirer.Separator(),
      { name: '🔙 Back to Shows', value: 'back' }
    );

    const answer = await inquirer.prompt([
      {
        type: 'list',
        name: 'season',
        message: 'Select a season:',
        choices: choices
      }
    ]);

    if (answer.season === 'back') {
      return 'shows';
    }

    const result = await showEpisodesList(show, answer.season);
    
    // Handle navigation results
    if (result === 'seasons') {
      continue; // Stay in seasons list
    } else if (result === 'shows') {
      return 'shows'; // Go back to shows
    } else if (result === 'exit') {
      return 'exit'; // Exit the app
    }
  }
}

/**
 * Show all shows list with easy search access
 */
async function showShowsList() {
  // Start with search prompt if user presses Ctrl+S at startup
  let autoSearch = process.argv.includes('--search') || process.argv.includes('-s');
  
  while (true) {
    console.clear();
    console.log('\n🎬 TrpTv - Simple TV Streamer');
    console.log('═'.repeat(35));
    
    // Auto-trigger search if requested
    if (autoSearch) {
      autoSearch = false;
      const searchAnswer = await inquirer.prompt([
        {
          type: 'input',
          name: 'query',
          message: '🔍 Enter search term (leave empty to see all shows):',
          default: currentSearchTerm
        }
      ]);
      currentSearchTerm = searchAnswer.query.trim();
    }

    const shows = searchShows(currentSearchTerm);
    
    if (currentSearchTerm) {
      console.log(`🔍 Search: "${currentSearchTerm}" - ${shows.length} results`);
      console.log('💡 Select a show or search again\n');
    } else {
      console.log(`📺 All Shows - ${shows.length} available`);
      console.log('💡 Use search to find specific shows\n');
    }

    const choices = [];
    
    // Search at the very top for easy access
    choices.push({ name: '� Search Shows [Shortcut: Ctrl+S next time]', value: 'search' });
    
    if (currentSearchTerm) {
      choices.push({ name: '�️  Clear Search (Show All)', value: 'clear_search' });
    }
    
    choices.push(new inquirer.Separator());

    // Show list
    shows.slice(0, 50).forEach(show => {
      const episodeInfo = show.total_episodes > 0 
        ? `${show.available_seasons}S, ${show.total_episodes}E`
        : 'No episodes available';
      
      choices.push({
        name: `${show.title} (${episodeInfo})`,
        value: show
      });
    });

    if (shows.length > 50) {
      choices.push(new inquirer.Separator());
      choices.push({ 
        name: `📋 Showing first 50 of ${shows.length} shows - use search to find specific ones`, 
        value: 'search' 
      });
    }

    choices.push(new inquirer.Separator());
    choices.push({ name: '❌ Exit', value: 'exit' });

    const answer = await inquirer.prompt([
      {
        type: 'list',
        name: 'selection',
        message: 'Select an option:',
        choices: choices,
        pageSize: 15
      }
    ]);

    // Handle selections
    if (answer.selection === 'search') {
      const searchAnswer = await inquirer.prompt([
        {
          type: 'input',
          name: 'query',
          message: '🔍 Enter search term:',
          default: currentSearchTerm
        }
      ]);
      currentSearchTerm = searchAnswer.query.trim();
      continue;
    }

    if (answer.selection === 'clear_search') {
      currentSearchTerm = '';
      continue;
    }

    if (answer.selection === 'exit') {
      console.log('👋 Goodbye!');
      process.exit(0);
    }

    // Selected a show
    if (typeof answer.selection === 'object' && answer.selection.title) {
      // Check if show has episodes before trying to load
      if (answer.selection.total_episodes === 0) {
        console.log(`\n❌ "${answer.selection.title}" has no episodes available.`);
        console.log('This show might be coming soon or not yet processed.');
        console.log('Press Enter to continue...');
        await inquirer.prompt([{ type: 'input', name: 'continue', message: '' }]);
        continue;
      }
      
      try {
        const fullShow = await loadFullData(answer.selection.title);
        const navResult = await showSeasonsList(answer.selection, fullShow);
        
        if (navResult === 'shows') {
          continue; // Back to shows list
        } else if (navResult === 'exit') {
          console.log('👋 Goodbye!');
          process.exit(0);
        }
      } catch (error) {
        console.log(`❌ Error loading show: ${error.message}`);
        console.log('Press Enter to continue...');
        await inquirer.prompt([{ type: 'input', name: 'continue', message: '' }]);
      }
    }
  }
}

/**
 * Display help message
 */
function showHelp() {
  console.log(`
🎬 TrpTv - Simple TV Shows Streamer

Usage:
  node tv_cli.js          Start with full shows list
  node tv_cli.js -s       Start with search prompt
  node tv_cli.js --search Start with search prompt

Controls in the app:
  - Use arrow keys to navigate
  - Press Enter to select
  - The search option is always at the top for quick access

Episode Navigation:
  - After watching an episode, you can go to next/previous episodes
  - Or jump back to episodes list, seasons list, or main shows list

Examples:
  node tv_cli.js -s       # Start by searching for shows
  node tv_cli.js          # Browse all shows first
`);
}

/**
 * Main function
 */
async function main() {
  try {
    // Handle command line arguments
    if (process.argv.includes('--help') || process.argv.includes('-h')) {
      showHelp();
      process.exit(0);
    }

    console.clear();
    console.log('🚀 Starting TrpTv...');
    
    await loadMetadata();
    console.log('💡 Tip: Use "node tv_cli.js -s" to start with search next time!');
    await showShowsList();
    
  } catch (error) {
    console.error('❌ Fatal error:', error.message);
    
    if (error.message.includes('Metadata file not found')) {
      console.log('\n💡 Quick fix:');
      console.log('   1. Run: node generate_metadata.js');
      console.log('   2. Then run: node tv_cli.js');
    }
    
    process.exit(1);
  }
}

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
  console.log('\n👋 Goodbye!');
  process.exit(0);
});

// Handle the Ctrl+S shortcut hint
console.log('💡 Tip: Run with "node tv_cli.js -s" to start with search');
console.log('🎯 Or press Ctrl+C if you want to restart with search option');

main();