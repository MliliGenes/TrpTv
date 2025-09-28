#!/usr/bin/env node
/**
 * TrpTv - Search shows and stream entire seasons in mpv
 * Extracts actual stream URLs from 123moviespremium.net
 */

import axios from "axios";
import * as cheerio from "cheerio";
import inquirer from "inquirer";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// TV Shows metadata cache (lightweight for search)
let metadataCache = null;
let fullDataCache = null;
let isMetadataLoading = false;
let isFullDataLoading = false;
let lastMetadataLoad = null;
let lastFullDataLoad = null;

// Cache settings
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

// File paths
const METADATA_FILE = path.join(__dirname, 'cartoons_metadata.json');
const FULL_DATA_FILE = path.join(__dirname, 'cartoons_data.json');

/**
 * Load metadata file (lightweight, for search and listing)
 */
async function loadMetadata(force = false) {
  // Return cached data if already loaded and not forcing reload
  if (metadataCache && !force) {
    return metadataCache;
  }

  // Prevent multiple simultaneous loads
  if (isMetadataLoading) {
    console.log('⏳ Metadata is already being loaded, please wait...');
    while (isMetadataLoading) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return metadataCache;
  }

  isMetadataLoading = true;
  
  try {
    // Check if metadata file exists
    if (!fs.existsSync(METADATA_FILE)) {
      console.log('📁 Metadata file not found, generating it first...');
      console.log('💡 Run: node generate_metadata.js');
      throw new Error(`Metadata file not found: ${METADATA_FILE}`);
    }

    // Get file size for progress indication
    const stats = fs.statSync(METADATA_FILE);
    const fileSizeKB = Math.round(stats.size / 1024);
    
    console.log(`📚 Loading TV shows metadata (${fileSizeKB}KB)...`);
    
    // Load and parse JSON
    const startTime = Date.now();
    const rawData = fs.readFileSync(METADATA_FILE, 'utf8');
    
    console.log('🔄 Parsing metadata...');
    metadataCache = JSON.parse(rawData);
    
    const loadTime = Date.now() - startTime;
    const showCount = metadataCache.shows ? metadataCache.shows.length : 0;
    
    console.log(`✅ Loaded metadata for ${showCount} shows in ${loadTime}ms`);
    
    // Validate metadata structure
    if (!metadataCache.shows || !Array.isArray(metadataCache.shows)) {
      throw new Error('Invalid metadata format: missing or invalid shows array');
    }

    if (!metadataCache.search_index) {
      console.log('⚠️  No search index found in metadata, basic search will be used');
    }
    
    lastMetadataLoad = Date.now();
    isMetadataLoading = false;
    return metadataCache;
    
  } catch (error) {
    isMetadataLoading = false;
    
    if (error instanceof SyntaxError) {
      console.error('❌ Invalid JSON format in metadata file:', error.message);
    } else if (error.code === 'ENOENT') {
      console.error('❌ Metadata file not found');
      console.error('💡 Generate it first with: node generate_metadata.js');
    } else {
      console.error('❌ Error loading metadata:', error.message);
    }
    
    console.error('🔧 Troubleshooting:');
    console.error('   1. Run: node generate_metadata.js');
    console.error('   2. Check if cartoons_data.json exists');
    console.error('   3. Verify file permissions');
    
    process.exit(1);
  }
}

/**
 * Load full show data (heavy, only when needed for streaming)
 */
async function loadFullData(showTitle) {
  try {
    // Check if full data file exists
    if (!fs.existsSync(FULL_DATA_FILE)) {
      throw new Error(`Full data file not found: ${FULL_DATA_FILE}`);
    }

    console.log(`🔍 Loading full data for "${showTitle}"...`);
    const startTime = Date.now();
    
    const rawData = fs.readFileSync(FULL_DATA_FILE, 'utf8');
    const fullData = JSON.parse(rawData);
    
    const loadTime = Date.now() - startTime;
    console.log(`✅ Loaded full data in ${loadTime}ms`);
    
    // Find and return the specific show
    const show = fullData.cartoons.find(s => s.title === showTitle);
    if (!show) {
      throw new Error(`Show "${showTitle}" not found in full data`);
    }
    
    return show;
    
  } catch (error) {
    console.error('❌ Error loading full show data:', error.message);
    throw error;
  }
}

/**
 * Get metadata with automatic loading and cache validation
 */
async function getMetadata() {
  // Check if cache is expired (older than CACHE_DURATION)
  const isCacheExpired = lastMetadataLoad && (Date.now() - lastMetadataLoad) > CACHE_DURATION;
  
  if (!metadataCache || isCacheExpired) {
    if (isCacheExpired) {
      console.log('🔄 Metadata cache expired, reloading...');
    }
    await loadMetadata(isCacheExpired);
  }
  return metadataCache;
}

/**
 * Get cached shows count
 */
function getCachedShowsCount() {
  return metadataCache ? metadataCache.shows.length : 0;
}

/**
 * Get shows by category for easier browsing
 */
async function getShowsByCategory(category) {
  const metadata = await getMetadata();
  let shows = metadata.shows.filter(show => show.total_episodes > 0);
  
  switch (category) {
    case 'popular':
      return shows.sort((a, b) => b.total_episodes - a.total_episodes).slice(0, 50);
      
    case 'recent':
      return shows.sort((a, b) => new Date(b.last_updated) - new Date(a.last_updated)).slice(0, 30);
      
    case 'long_running':
      return shows.filter(show => show.total_episodes > 100).sort((a, b) => b.total_episodes - a.total_episodes);
      
    case 'short_series':
      return shows.filter(show => show.total_episodes <= 26).sort((a, b) => b.total_episodes - a.total_episodes);
      
    case 'multi_season':
      return shows.filter(show => show.available_seasons > 3).sort((a, b) => b.available_seasons - a.available_seasons);
      
    case 'single_season':
      return shows.filter(show => show.available_seasons === 1).sort((a, b) => b.total_episodes - a.total_episodes);
      
    default:
      return shows.sort((a, b) => b.total_episodes - a.total_episodes);
  }
}

/**
 * Get show statistics for display
 */
function getShowStats(shows) {
  if (!shows || shows.length === 0) return null;
  
  const totalEpisodes = shows.reduce((sum, show) => sum + show.total_episodes, 0);
  const avgEpisodes = Math.round(totalEpisodes / shows.length);
  const longestShow = shows.reduce((max, show) => show.total_episodes > max.total_episodes ? show : max, shows[0]);
  
  return {
    count: shows.length,
    totalEpisodes,
    avgEpisodes,
    longestShow: longestShow.title,
    longestEpisodes: longestShow.total_episodes
  };
}

/**
 * Calculate safe page size to prevent terminal overflow
 */
function getSafePageSize(overhead = 10, min = 6, max = 20) {
  const terminalHeight = process.stdout.rows || 24;
  const safeSize = Math.max(min, Math.min(terminalHeight - overhead, max));
  return safeSize;
}

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
};

async function getActualStreamUrl(idd, season, episode) {
  /**
   * Extract streaming URLs from multiple sources with fallback mechanisms
   */
  const baseUrl = `https://stevenuniverse.best/video-player/?idd=${idd}&season=${season}&episode=${episode}`;
  const referer = "https://stevenuniverse.best";

  try {
    console.log(`🔍 Extracting stream URL for S${season}E${episode}...`);
    
    // Step 1: Fetch the video player page
    const { data: html } = await axios.get(baseUrl, {
      headers: { ...HEADERS, "Referer": referer },
      timeout: 20000
    });

    const $ = cheerio.load(html);
    let watchUrl = null;
    
    // Define streaming source patterns to look for
    const streamingPatterns = [
      /123moviespremium\.net\/watch\//,
      /123movies\w*\.net\/watch\//,
      /movies123\..*\/watch\//,
      /fmovies\..*\/watch\//,
      /gomovies\..*\/watch\//,
      /gomovies-sx\.net\/embed\//,
      /gomovies\w*\..*\/embed\//,
      /putlocker\..*\/watch\//,
      /solarmovie\..*\/watch\//,
      /vidsrc\..*\/embed\//,
      /embed\..*\/.*\?.*=/,
      /player\..*\/.*\?.*=/
    ];
    
    // Step 2: Look for streaming URLs in various elements
    const searchElements = ["iframe", "script", "a", "source", "video"];
    const searchAttributes = ["src", "href", "data-src", "data-url"];
    
    for (const element of searchElements) {
      $(element).each((_, el) => {
        // Check all relevant attributes
        for (const attr of searchAttributes) {
          const url = $(el).attr(attr);
          if (url && streamingPatterns.some(pattern => pattern.test(url))) {
            watchUrl = url.replace(/&amp;/g, "&");
            return false; // Break out of loops
          }
        }
        
        // Also check text content for URLs
        const text = $(el).text();
        if (text && streamingPatterns.some(pattern => pattern.test(text))) {
          // Extract URL from text using regex
          const urlMatch = text.match(/(https?:\/\/[^\s'"<>]+)/);
          if (urlMatch && streamingPatterns.some(pattern => pattern.test(urlMatch[1]))) {
            watchUrl = urlMatch[1];
            return false;
          }
        }
      });
      
      if (watchUrl) break;
    }
    
    // Step 3: If no streaming URL found, try to extract any video-like URLs
    if (!watchUrl) {
      console.log(`🔄 No standard streaming URL found, searching for alternative sources...`);
      
      // Look for any URLs that might be video sources
      const videoPatterns = [
        /\.mp4(\?|$)/,
        /\.m3u8(\?|$)/,
        /\.webm(\?|$)/,
        /\/embed\/.*\?/,
        /\/player\/.*\?/,
        /\/watch\/.*\?/
      ];
      
      $("iframe, script, a, source, video").each((_, el) => {
        const url = $(el).attr("src") || $(el).attr("href") || $(el).attr("data-src");
        if (url && videoPatterns.some(pattern => pattern.test(url))) {
          watchUrl = url.replace(/&amp;/g, "&");
          return false;
        }
      });
    }

    // Step 4: Handle embed URLs that require browser execution
    const browserRequiredPatterns = [
      /gomovies-sx\.net\/embed/,
      /embed\..*\/tv\//,
      /player\..*\/embed/,
      /cloudnestra\.com/
    ];
    
    const requiresBrowser = watchUrl && browserRequiredPatterns.some(pattern => pattern.test(watchUrl));
    
    if (requiresBrowser) {
      console.log(`🌐 This embed URL requires browser execution: ${watchUrl.substring(0, 60)}...`);
      console.log(`🚀 Opening in browser instead of mpv...`);
      return { url: watchUrl, requiresBrowser: true };
    }

    if (!watchUrl) {
      console.warn(`⚠️  No streaming URL found for S${season}E${episode}`);
      console.log(`🐛 Debug: Checking page content...`);
      
      // Debug: Show what we found in the page
      const iframes = $("iframe").length;
      const scripts = $("script").length;
      console.log(`   Found ${iframes} iframes, ${scripts} scripts`);
      
      return null;
    }

    console.log(`✅ Found stream URL: ${watchUrl.substring(0, 80)}...`);
    return watchUrl;

  } catch (error) {
    console.error(`❌ Error getting stream URL for S${season}E${episode}:`, error.message);
    return null;
  }
}



async function searchShows(query) {
  /**
   * Search shows using lightweight metadata with built-in search index
   */
  const metadata = await getMetadata();
  
  if (!query || query.trim().length === 0) {
    // Return all shows sorted by popularity (episode count)
    return metadata.shows
      .filter(show => show.total_episodes > 0)
      .sort((a, b) => b.total_episodes - a.total_episodes);
  }
  
  const searchTerm = query.toLowerCase().trim();
  const searchWords = searchTerm.split(' ').filter(word => word.length > 0);
  
  // Use built-in search index from metadata if available
  if (metadata.search_index && metadata.search_index.search_terms) {
    const matchingIndices = new Set();
    
    // Search through indexed terms
    Object.entries(metadata.search_index.search_terms).forEach(([term, indices]) => {
      if (term.includes(searchTerm)) {
        indices.forEach(idx => matchingIndices.add(idx));
      }
    });
    
    // Multi-word search
    if (searchWords.length > 1) {
      const wordMatches = searchWords.map(word => {
        const wordIndices = new Set();
        Object.entries(metadata.search_index.search_terms).forEach(([term, indices]) => {
          if (term.includes(word)) {
            indices.forEach(idx => wordIndices.add(idx));
          }
        });
        return wordIndices;
      });
      
      // Find intersection of all word matches
      const intersection = [...wordMatches[0]].filter(idx => 
        wordMatches.every(wordSet => wordSet.has(idx))
      );
      
      intersection.forEach(idx => matchingIndices.add(idx));
    }
    
    // Convert indices to shows and sort by relevance
    const results = [...matchingIndices]
      .map(idx => metadata.shows[idx])
      .filter(show => show) // Remove any invalid indices
      .sort((a, b) => {
        // Exact title match first
        if (a.title.toLowerCase() === searchTerm) return -1;
        if (b.title.toLowerCase() === searchTerm) return 1;
        
        // Title starts with search term
        if (a.title.toLowerCase().startsWith(searchTerm)) return -1;
        if (b.title.toLowerCase().startsWith(searchTerm)) return 1;
        
        // More episodes = higher relevance
        return b.total_episodes - a.total_episodes;
      });
    
    return results;
  }
  
  // Fallback to simple filtering if no search index
  return metadata.shows.filter(show => 
    show.search_terms && show.search_terms.some(term => term.includes(searchTerm))
  );
}

async function promptShowSearch() {
  /**
   * Interactive show browser with search filtering and pagination
   */
  const metadata = await getMetadata();
  let currentQuery = '';
  let currentPage = 0;
  const itemsPerPage = 15;

  while (true) {
    console.clear();
    // Add a small delay to ensure terminal is properly cleared
    await new Promise(resolve => setTimeout(resolve, 50));
    console.log('\n🎬 TrpTv Streaming CLI');
    console.log('═════════════════════\n');

    // Get filtered results based on current query
    const allResults = currentQuery ? await searchShows(currentQuery) : metadata.shows
      .filter(show => show.total_episodes > 0)
      .sort((a, b) => b.total_episodes - a.total_episodes);
    const totalResults = allResults.length;
    
    // Calculate pagination
    const totalPages = Math.ceil(totalResults / itemsPerPage);
    const startIndex = currentPage * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, totalResults);
    const pageResults = allResults.slice(startIndex, endIndex);

    // Show current status
    if (currentQuery) {
      console.log(`🔍 Search: "${currentQuery}" - ${totalResults} results`);
    } else {
      console.log(`📺 All Shows - ${totalResults} available`);
    }
    
    if (totalPages > 1) {
      console.log(`📄 Page ${currentPage + 1} of ${totalPages} (${startIndex + 1}-${endIndex} of ${totalResults})`);
    }
    console.log('');

    if (pageResults.length === 0) {
      console.log('❌ No shows found.');
      console.log('� Try a different search term or clear the search.\n');
    }

    // Prepare choices with episode counts from metadata
    const choices = [];
    
    // Add search and browse options at the top
    choices.push({
      name: currentQuery ? 
        `🔍 Change search (current: "${currentQuery}")` : 
        `🔍 Search shows`,
      value: "search",
      short: "Search"
    });

    choices.push({
      name: "📂 Browse by category",
      value: "browse_category",
      short: "Browse"
    });

    if (currentQuery) {
      choices.push({
        name: "🗑️  Clear search (show all)",
        value: "clear_search",
        short: "Clear"
      });
    }

    choices.push(new inquirer.Separator());

    // Add show results
    pageResults.forEach(show => {
      choices.push({
        name: `${show.title} (${show.available_seasons} seasons, ${show.total_episodes} episodes)`,
        value: show,
        short: show.title
      });
    });

    // Add pagination and navigation options
    if (pageResults.length > 0) {
      choices.push(new inquirer.Separator());
      
      // Pagination controls
      if (currentPage > 0) {
        choices.push({
          name: "⬅️  Previous page",
          value: "prev_page",
          short: "Previous"
        });
      }
      
      if (currentPage < totalPages - 1) {
        choices.push({
          name: "➡️  Next page",
          value: "next_page",
          short: "Next"
        });
      }
      
      if (totalPages > 2) {
        choices.push({
          name: "📄 Jump to page...",
          value: "jump_page",
          short: "Jump"
        });
      }
    }

    choices.push(
      new inquirer.Separator(),
      { name: "❌ Exit", value: "exit", short: "Exit" }
    );

    const answer = await inquirer.prompt([
      {
        type: "list",
        name: "selection",
        message: "Select a show or action:",
        choices: choices,
        pageSize: getSafePageSize(12, 8, 18)
      }
    ]);

    // Handle different selection types
    if (answer.selection === "search") {
      const searchAnswer = await inquirer.prompt([
        {
          type: "input",
          name: "query",
          message: "🔍 Enter search term:",
          default: currentQuery,
          filter: (input) => input.trim()
        }
      ]);
      currentQuery = searchAnswer.query;
      currentPage = 0; // Reset to first page when searching
      continue;
      
    } else if (answer.selection === "browse_category") {
      const categoryAnswer = await inquirer.prompt([
        {
          type: "list",
          name: "category",
          message: "📂 Browse shows by category:",
          choices: [
            { name: "🔥 Most Popular (by episodes)", value: "popular" },
            { name: "📺 Long Running Series (100+ episodes)", value: "long_running" },
            { name: "🎬 Short Series (≤26 episodes)", value: "short_series" },
            { name: "📚 Multi-Season Shows (4+ seasons)", value: "multi_season" },
            { name: "⭐ Single Season Shows", value: "single_season" },
            new inquirer.Separator(),
            { name: "🔙 Back to main browse", value: "back" }
          ],
          pageSize: getSafePageSize(10, 6, 8)
        }
      ]);
      
      if (categoryAnswer.category !== "back") {
        const categoryShows = await getShowsByCategory(categoryAnswer.category);
        const stats = getShowStats(categoryShows);
        
        console.clear();
        console.log(`\n📂 Category: ${categoryAnswer.category}`);
        console.log('─'.repeat(30));
        if (stats) {
          console.log(`Shows: ${stats.count} | Total Episodes: ${stats.totalEpisodes}`);
          console.log(`Average: ${stats.avgEpisodes} episodes | Longest: ${stats.longestShow} (${stats.longestEpisodes} episodes)`);
        }
        console.log('');
        
        // Show category results with pagination
        const categoryChoices = categoryShows.slice(0, 15).map(show => ({
          name: `${show.title} (${show.available_seasons} seasons, ${show.total_episodes} episodes)`,
          value: show,
          short: show.title
        }));
        
        categoryChoices.push(
          new inquirer.Separator(),
          { name: "🔙 Back to categories", value: "back_to_categories" }
        );
        
        const categorySelection = await inquirer.prompt([
          {
            type: "list",
            name: "show",
            message: "Select a show from this category:",
            choices: categoryChoices,
            pageSize: getSafePageSize(10, 8, 12)
          }
        ]);
        
        if (categorySelection.show !== "back_to_categories") {
          return categorySelection.show;
        }
      }
      continue;
      
    } else if (answer.selection === "clear_search") {
      currentQuery = '';
      currentPage = 0;
      continue;
      
    } else if (answer.selection === "prev_page") {
      currentPage = Math.max(0, currentPage - 1);
      continue;
      
    } else if (answer.selection === "next_page") {
      currentPage = Math.min(totalPages - 1, currentPage + 1);
      continue;
      
    } else if (answer.selection === "jump_page") {
      const pageAnswer = await inquirer.prompt([
        {
          type: "input",
          name: "page",
          message: `Jump to page (1-${totalPages}):`,
          default: (currentPage + 1).toString(),
          validate: (input) => {
            const page = parseInt(input);
            if (isNaN(page) || page < 1 || page > totalPages) {
              return `Please enter a number between 1 and ${totalPages}`;
            }
            return true;
          },
          filter: (input) => parseInt(input)
        }
      ]);
      currentPage = Math.max(0, Math.min(totalPages - 1, pageAnswer.page - 1));
      continue;
      
    } else if (answer.selection === "exit") {
      console.log('👋 Goodbye!');
      process.exit(0);
      
    } else {
      // Selected a show
      return answer.selection;
    }
  }
}

async function promptSeasonSelection(show) {
  /**
   * Select season to stream - loads full data on demand
   */
  console.clear();
  console.log(`\n📺 ${show.title}`);
  console.log('─'.repeat(show.title.length + 4));
  
  // Load full show data for detailed season/episode information
  let fullShow;
  try {
    fullShow = await loadFullData(show.title);
  } catch (error) {
    console.log('\n❌ Failed to load detailed episode data for this show.');
    console.log('Press any key to go back...');
    await new Promise(resolve => {
      process.stdin.once('data', resolve);
    });
    return null;
  }
  
  // Filter seasons with episodes from full data
  const availableSeasons = fullShow.seasons.filter(season => 
    season.episodes && season.episodes.length > 0
  );
  
  if (availableSeasons.length === 0) {
    console.log('\n❌ No episodes available for this show.\n');
    await new Promise(resolve => setTimeout(resolve, 2000));
    return null;
  }

  const seasonChoices = availableSeasons.map(season => ({
    name: `Season ${season.season_number} (${season.episodes.length} episodes)`,
    value: season,
    short: `Season ${season.season_number}`
  }));

  seasonChoices.push(
    new inquirer.Separator(),
    { name: "🔙 Back to show search", value: null }
  );

  const seasonAnswer = await inquirer.prompt([
    {
      type: "list",
      name: "selectedSeason",
      message: "Select a season to stream:",
      choices: seasonChoices,
      pageSize: getSafePageSize(8, 6, 10)
    }
  ]);

  return seasonAnswer.selectedSeason;
}

async function promptWatchOption() {
  /**
   * Prompt user to choose between watching one episode or the whole season
   */
  const watchAnswer = await inquirer.prompt([
    {
      type: "list",
      name: "watchType",
      message: "What would you like to watch?",
      choices: [
        { name: "📺 Watch one episode", value: "episode" },
        { name: "🎬 Watch entire season", value: "season" },
        new inquirer.Separator(),
        { name: "🔙 Back to season selection", value: "back" }
      ],
      pageSize: getSafePageSize(8, 4, 5)
    }
  ]);

  return watchAnswer.watchType;
}

async function promptEpisodeSelection(season) {
  /**
   * Select a specific episode from the season
   */
  console.clear();
  console.log(`\n📺 Season ${season.season_number} Episodes`);
  console.log('─'.repeat(`Season ${season.season_number} Episodes`.length + 2));
  console.log(`\nChoose from ${season.episodes.length} available episodes:\n`);
  
  const episodeChoices = season.episodes.map((episode, index) => ({
    name: `Episode ${episode.episode_id}: ${episode.title}`,
    value: episode,
    short: `E${episode.episode_id}`
  }));

  episodeChoices.push(
    new inquirer.Separator(),
    { name: "🔙 Back to watch options", value: null }
  );

  const episodeAnswer = await inquirer.prompt([
    {
      type: "list",
      name: "selectedEpisode",
      message: "Select an episode to watch:",
      choices: episodeChoices,
      pageSize: getSafePageSize(10, 8, 12)
    }
  ]);

  return episodeAnswer.selectedEpisode;
}

async function getAllSeasonStreamUrls(season, showTitle) {
  /**
   * Extract actual stream URLs for all episodes in a season with improved handling
   */
  console.log(`\n🔄 Preparing ${season.episodes.length} episodes from Season ${season.season_number}...`);
  console.log('This may take a moment as we extract stream URLs from multiple sources...\n');
  
  const streamUrls = [];
  const failedEpisodes = [];
  const total = season.episodes.length;
  
  for (let i = 0; i < season.episodes.length; i++) {
    const episode = season.episodes[i];
    const progress = `[${i + 1}/${total}]`;
    
    process.stdout.write(`\r${progress} Processing "${episode.title}"...                    `);
    
    // Extract stream URL with multiple source support
    const streamUrl = await getActualStreamUrl(
      episode.show_id, 
      episode.season_id, 
      episode.episode_id
    );
    
    if (streamUrl) {
      streamUrls.push({
        title: `S${episode.season_id}E${episode.episode_id} - ${episode.title}`,
        url: streamUrl,
        episode: episode
      });
      process.stdout.write(`\r${progress} ✅ "${episode.title}"                    `);
    } else {
      failedEpisodes.push(`E${episode.episode_id} - ${episode.title}`);
      process.stdout.write(`\r${progress} ❌ "${episode.title}"                    `);
    }
    
    console.log(); // New line for next episode
    
    // Respectful delay with shorter interval for better UX
    await new Promise(resolve => setTimeout(resolve, 800));
  }
  
  console.log(`\n📊 Results Summary:`);
  console.log(`   ✅ Successfully found: ${streamUrls.length}/${total} episodes`);
  
  if (failedEpisodes.length > 0) {
    console.log(`   ❌ Failed to find streams for: ${failedEpisodes.length} episodes`);
    console.log(`   📝 Failed episodes: ${failedEpisodes.slice(0, 3).join(', ')}${failedEpisodes.length > 3 ? '...' : ''}`);
  }
  
  if (streamUrls.length === 0) {
    throw new Error("No valid stream URLs found for this season. The source might be unavailable or the show data may be outdated.");
  }
  
  if (streamUrls.length < total) {
    console.log(`\n⚠️  Some episodes couldn't be loaded. Proceeding with ${streamUrls.length} available episodes.`);
    
    // Ask user if they want to continue with partial episodes
    const continueAnswer = await inquirer.prompt([
      {
        type: "confirm",
        name: "continue",
        message: `Continue with ${streamUrls.length} working episodes?`,
        default: true
      }
    ]);
    
    if (!continueAnswer.continue) {
      throw new Error("Streaming cancelled by user");
    }
  }
  
  return streamUrls;
}

async function createMpvPlaylist(streamUrls, showTitle, seasonNumber) {
  /**
   * Create M3U playlist file for mpv
   */
  const safeTitle = showTitle.replace(/[^a-zA-Z0-9]/g, '_');
  const playlistPath = path.join(__dirname, `${safeTitle}_S${seasonNumber}.m3u`);
  
  let playlistContent = '#EXTM3U\n';
  
  streamUrls.forEach(item => {
    playlistContent += `#EXTINF:-1,${item.title}\n`;
    playlistContent += `${item.url}\n`;
  });
  
  fs.writeFileSync(playlistPath, playlistContent);
  console.log(`📝 Playlist saved: ${path.basename(playlistPath)}`);
  
  return playlistPath;
}

async function streamSeasonInMpv(idd, seasonData, seasonNumber) {
  /**
   * Stream all episodes of a season in sequence
   * URLs are fetched on-demand to prevent expiration
   */
  const episodes = seasonData.episodes;
  console.log(`🎬 Starting Season ${seasonNumber} with ${episodes.length} episodes...`);
  console.log("URLs will be fetched just before each episode to ensure freshness.\n");

  let browserEpisodes = [];
  let successfulEpisodes = 0;
  let failedEpisodes = 0;

  // Stream episodes one by one, fetching URLs on-demand
  for (let i = 0; i < episodes.length; i++) {
    const episode = episodes[i];
    console.log(`\n[${i + 1}/${episodes.length}] Preparing Episode ${episode.episode_id}: "${episode.title}"...`);
    
    // Fetch stream URL just before playing
    const streamResult = await getActualStreamUrl(idd, seasonNumber, episode.episode_id);
    
    if (!streamResult) {
      console.log(`❌ Failed to get stream URL for episode ${episode.episode_id}. Skipping...`);
      failedEpisodes++;
      continue;
    }
    
    // Handle browser-required episodes
    if (typeof streamResult === 'object' && streamResult.requiresBrowser) {
      browserEpisodes.push({
        episode: episode,
        url: streamResult.url
      });
      console.log(`🌐 Episode ${episode.episode_id} requires browser playback - added to browser list.`);
      continue;
    }

    // Play episode immediately in mpv
    const streamUrl = typeof streamResult === 'string' ? streamResult : streamResult.url;
    console.log(`🎬 Starting Episode ${episode.episode_id} in mpv...`);
    console.log(`💡 mpv Controls: SPACE = Pause/Play | Q = Quit | F = Fullscreen\n`);
    
    const mpvProcess = spawn("mpv", [streamUrl], { stdio: "inherit" });
    
    const playResult = await new Promise((resolve) => {
      mpvProcess.on("close", (code) => {
        resolve(code);
      });
    });
    
    if (playResult === 0) {
      console.log(`\n✅ Episode ${episode.episode_id} completed successfully!`);
      successfulEpisodes++;
    } else {
      console.log(`\n⚠️  Episode ${episode.episode_id} ended unexpectedly (code ${playResult}).`);
      
      // Ask if user wants to continue or quit
      if (i < episodes.length - 1) {
        const continueAnswer = await inquirer.prompt([
          {
            type: "confirm",
            name: "continue",
            message: "Continue to next episode?",
            default: true
          }
        ]);
        
        if (!continueAnswer.continue) {
          console.log("🛑 Season streaming stopped by user.");
          break;
        }
      }
    }
  }

  // Show summary
  console.log(`\n🎉 Season ${seasonNumber} streaming complete!`);
  console.log(`📊 Summary:`);
  console.log(`   ✅ Successfully watched: ${successfulEpisodes} episodes`);
  if (failedEpisodes > 0) {
    console.log(`   ❌ Failed to load: ${failedEpisodes} episodes`);
  }
  
  // Handle browser episodes at the end
  if (browserEpisodes.length > 0) {
    console.log(`\n🌐 ${browserEpisodes.length} episodes require browser playback:`);
    for (const item of browserEpisodes) {
      console.log(`   Episode ${item.episode.episode_id}: ${item.episode.title}`);
      console.log(`   URL: ${item.url}`);
    }
    console.log(`\n💡 Please open these URLs manually in your browser.`);
  }
  
  console.log("👋 Thanks for watching!");
}

async function streamEpisodeInMpv(idd, season, episode, episodeName) {
  /**
   * Stream a single episode using mpv player or browser
   */
  try {
    console.log(`🔄 Preparing S${season}E${episode} - ${episodeName}...`);
    console.log("Extracting stream URL from available sources...");
    
    const streamResult = await getActualStreamUrl(idd, season, episode);
    if (!streamResult) {
      console.error("❌ Error streaming episode: Failed to get stream URL for this episode");
      return false;
    }

    // Handle browser-required URLs
    if (typeof streamResult === 'object' && streamResult.requiresBrowser) {
      console.log(`🌐 Opening S${season}E${episode} in your default browser...`);
      console.log(`💡 Browser Controls:\n   Click play button on the page\n   Use browser's fullscreen controls\n   Close tab when done\n`);
      
      const { spawn } = await import('child_process');
      
      // Try different browser commands based on system
      const browserCommands = ['xdg-open', 'open', 'start'];
      
      for (const cmd of browserCommands) {
        try {
          spawn(cmd, [streamResult.url], { detached: true, stdio: 'ignore' });
          console.log(`✅ Opened in browser successfully!`);
          return true;
        } catch (error) {
          continue; // Try next command
        }
      }
      
      console.log(`❌ Could not open browser automatically. Please open this URL manually:`);
      console.log(`🔗 ${streamResult.url}`);
      return false;
    }

    // Handle regular streaming URLs with mpv
    const streamUrl = typeof streamResult === 'string' ? streamResult : streamResult.url;
    
    console.log(`🎬 Starting mpv for S${season}E${episode}...`);
    console.log(`💡 mpv Controls:\n   SPACE = Pause/Play\n   Q = Quit\n   F = Fullscreen\n`);
    
    const mpvProcess = spawn("mpv", [streamUrl], { stdio: "inherit" });

    return new Promise((resolve) => {
      mpvProcess.on("close", (code) => {
        if (code === 0) {
          console.log("👋 Goodbye!");
        } else {
          console.log(`🎬 mpv exited with code ${code}`);
        }
        resolve(code === 0);
      });
    });

  } catch (error) {
    console.error("❌ Error streaming episode:", error.message);
    return false;
  }
}

async function main() {
  /**
   * Main application loop
   */
  try {
    // Ensure clean terminal start
    console.clear();
    
    // Load TV shows metadata at startup
    console.log('🚀 Starting TrpTv...');
    await loadMetadata();
    console.log(`📺 Ready! ${getCachedShowsCount()} shows available for streaming\n`);
    
    // Main streaming loop
    while (true) {
      // Step 1: Search and select show
      const selectedShow = await promptShowSearch();
      
      while (true) {
        // Step 2: Select season
        const selectedSeason = await promptSeasonSelection(selectedShow);
        
        if (!selectedSeason) {
          break; // Go back to show search
        }
        
        while (true) {
          // Step 3: Choose to watch episode or season
          const watchType = await promptWatchOption();
          
          if (watchType === "back") {
            break; // Go back to season selection
          }
          
          if (watchType === "season") {
            // Step 4a: Confirm and stream entire season
            const confirmAnswer = await inquirer.prompt([
              {
                type: "confirm",
                name: "stream",
                message: `Stream ${selectedShow.title} Season ${selectedSeason.season_number} (${selectedSeason.episodes.length} episodes)?`,
                default: true
              }
            ]);
            
            if (confirmAnswer.stream) {
              // Get show_id from any episode in the season
              const showId = selectedSeason.episodes[0]?.show_id;
              await streamSeasonInMpv(showId, selectedSeason, selectedSeason.season_number);
              return; // Exit after streaming
            }
          } else if (watchType === "episode") {
            while (true) {
              // Step 4b: Select and stream specific episode
              const selectedEpisode = await promptEpisodeSelection(selectedSeason);
              
              if (!selectedEpisode) {
                break; // Go back to watch options
              }
              
              const confirmAnswer = await inquirer.prompt([
                {
                  type: "confirm",
                  name: "stream",
                  message: `Stream S${selectedEpisode.season_id}E${selectedEpisode.episode_id} - ${selectedEpisode.title}?`,
                  default: true
                }
              ]);
              
              if (confirmAnswer.stream) {
                try {
                  await streamEpisodeInMpv(
                    selectedEpisode.show_id, 
                    selectedEpisode.season_id, 
                    selectedEpisode.episode_id, 
                    selectedEpisode.title
                  );
                  return; // Exit after streaming
                } catch (episodeError) {
                  if (episodeError.message === "RETRY_EPISODE_SELECTION") {
                    continue; // Go back to episode selection
                  } else {
                    throw episodeError; // Re-throw other errors
                  }
                }
              }
            }
          }
        }
      }
    }
  } catch (error) {
    console.error("❌ Fatal error:", error.message);
    process.exit(1);
  }
}

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
  console.log('\n👋 Goodbye!');
  process.exit(0);
});

main();