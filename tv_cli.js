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

// Load shows data
let showsData = {};
try {
  const dataPath = path.join(__dirname, 'cartoons_data.json');
  showsData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
} catch (error) {
  console.error('❌ Error loading cartoons_data.json:', error.message);
  process.exit(1);
}

// Load cached working shows if available
const cacheFile = path.join(__dirname, '.working_shows_cache.json');
let workingShowsCache = {};
try {
  if (fs.existsSync(cacheFile)) {
    workingShowsCache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  }
} catch (error) {
  console.warn('⚠️  Could not load working shows cache, will rebuild as needed');
}

// Save working shows cache
function saveWorkingShowsCache() {
  try {
    fs.writeFileSync(cacheFile, JSON.stringify(workingShowsCache, null, 2));
  } catch (error) {
    console.warn('⚠️  Could not save working shows cache');
  }
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

// Cache for tested shows to avoid re-testing
const testedShows = new Map();

async function testShowAvailability(show, maxEpisodesToTest = 2) {
  /**
   * Test if a show has working stream URLs by checking a few episodes
   */
  const showKey = `${show.title}_${show.seasons?.[0]?.season_number || 'unknown'}`;
  
  // Return cached result if already tested (memory cache first, then persistent cache)
  if (testedShows.has(showKey)) {
    return testedShows.get(showKey);
  }
  
  if (workingShowsCache[showKey] !== undefined) {
    const result = workingShowsCache[showKey];
    testedShows.set(showKey, result);
    return result;
  }
  
  try {
    // Find first season with episodes
    const workingSeason = show.seasons?.find(season => 
      season.episodes && season.episodes.length > 0
    );
    
    if (!workingSeason) {
      testedShows.set(showKey, false);
      return false;
    }
    
    // Test first few episodes of the season
    const episodesToTest = workingSeason.episodes.slice(0, maxEpisodesToTest);
    let workingCount = 0;
    
    for (const episode of episodesToTest) {
      const streamUrl = await getActualStreamUrl(
        episode.show_id,
        episode.season_id,
        episode.episode_id
      );
      
      if (streamUrl) {
        workingCount++;
      }
      
      // Small delay to be respectful
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    const isWorking = workingCount > 0;
    testedShows.set(showKey, isWorking);
    workingShowsCache[showKey] = isWorking;
    saveWorkingShowsCache(); // Save to persistent cache
    return isWorking;
    
  } catch (error) {
    console.error(`Error testing show ${show.title}:`, error.message);
    testedShows.set(showKey, false);
    workingShowsCache[showKey] = false;
    saveWorkingShowsCache();
    return false;
  }
}

function searchShows(query) {
  /**
   * Search shows with dynamic filtering
   */
  if (!query || query.trim().length === 0) {
    return showsData.cartoons.slice(0, 30); // Show more since we'll filter
  }
  
  const searchTerm = query.toLowerCase().trim();
  return showsData.cartoons.filter(show => 
    show.title.toLowerCase().includes(searchTerm)
  );
}

async function bulkTestAllShows() {
  /**
   * Test all shows in the database for working streams (power user feature)
   */
  console.clear();
  console.log('\n🎬 TrpTv - Bulk Show Testing');
  console.log('═════════════════════════════\n');
  
  const allShows = showsData.cartoons;
  console.log(`🔍 Testing ${allShows.length} shows for working streams...`);
  console.log('This will take a while but will improve future searches!\n');
  
  const confirmAnswer = await inquirer.prompt([
    {
      type: "confirm",
      name: "proceed",
      message: "This will test all shows and may take 10-20 minutes. Continue?",
      default: false
    }
  ]);
  
  if (!confirmAnswer.proceed) {
    return;
  }
  
  let workingCount = 0;
  let totalTested = 0;
  
  for (let i = 0; i < allShows.length; i++) {
    const show = allShows[i];
    totalTested++;
    
    process.stdout.write(`\r[${i + 1}/${allShows.length}] Testing "${show.title}"...                              `);
    
    const isWorking = await testShowAvailability(show, 1); // Test only 1 episode for speed
    if (isWorking) {
      workingCount++;
      process.stdout.write(`\r[${i + 1}/${allShows.length}] ✅ "${show.title}"                              `);
    } else {
      process.stdout.write(`\r[${i + 1}/${allShows.length}] ❌ "${show.title}"                              `);
    }
    console.log(); // New line
  }
  
  console.log(`\n✅ Bulk testing complete!`);
  console.log(`   Working shows: ${workingCount}/${totalTested}`);
  console.log(`   Success rate: ${((workingCount/totalTested)*100).toFixed(1)}%`);
  console.log(`   Cache saved for future searches\n`);
  
  await new Promise(resolve => setTimeout(resolve, 3000));
}

async function promptShowSearch() {
  /**
   * Interactive show search with working show filtering
   */
  console.clear();
  console.log('\n🎬 TrpTv Streaming CLI');
  console.log('═════════════════════\n');

  while (true) {
    const searchAnswer = await inquirer.prompt([
      {
        type: "input",
        name: "search",
        message: "🔍 Search TV shows (or press Enter to browse):",
        filter: (input) => input.trim()
      }
    ]);

    const allResults = searchShows(searchAnswer.search);
    
    if (allResults.length === 0) {
      console.log('\n❌ No shows found. Try a different search term.\n');
      continue;
    }

    // Ask user if they want to filter for working shows
    const filterAnswer = await inquirer.prompt([
      {
        type: "list",
        name: "filterType",
        message: `Found ${allResults.length} show(s). How would you like to proceed?`,
        choices: [
          { name: "🎯 Show only verified working shows (slower but reliable)", value: "working" },
          { name: "📺 Show all shows (faster but may include broken ones)", value: "all" },
          new inquirer.Separator(),
          { name: "🔍 Search again", value: "search_again" }
        ]
      }
    ]);

    if (filterAnswer.filterType === "search_again") {
      continue;
    }

    let results = allResults.slice(0, 20);
    
    if (filterAnswer.filterType === "working") {
      console.clear();
      console.log('\n🎬 TrpTv Streaming CLI');
      console.log('═════════════════════\n');
      console.log('🔍 Testing shows for working streams...\n');
      console.log('This may take a moment but ensures better results!\n');
      
      const workingShows = [];
      
      for (let i = 0; i < results.length; i++) {
        const show = results[i];
        process.stdout.write(`\r[${i + 1}/${results.length}] Testing "${show.title}"...                    `);
        
        const isWorking = await testShowAvailability(show);
        if (isWorking) {
          workingShows.push(show);
          process.stdout.write(`\r[${i + 1}/${results.length}] ✅ "${show.title}"                    `);
        } else {
          process.stdout.write(`\r[${i + 1}/${results.length}] ❌ "${show.title}"                    `);
        }
        console.log(); // New line
      }
      
      results = workingShows;
      
      if (results.length === 0) {
        console.log('\n❌ No working shows found in this search. Try a different search term or browse all shows.\n');
        continue;
      }
      
      console.log(`\n✅ Found ${results.length} verified working shows!\n`);
    }

    // Clear and show final results
    console.clear();
    console.log('\n🎬 TrpTv Streaming CLI');
    console.log('═════════════════════\n');
    
    if (filterAnswer.filterType === "working") {
      console.log(`✅ ${results.length} Verified Working Shows:\n`);
    } else {
      console.log(`📺 ${results.length} Shows (unfiltered):\n`);
    }
    
    // Prepare choices with episode counts
    const choices = results.map(show => {
      const totalEpisodes = show.seasons.reduce((total, season) => 
        total + (season.episodes ? season.episodes.length : 0), 0
      );
      const availableSeasons = show.seasons.filter(s => s.episodes && s.episodes.length > 0).length;
      
      const workingIndicator = filterAnswer.filterType === "working" ? "✅ " : "";
      
      return {
        name: `${workingIndicator}${show.title} (${availableSeasons} seasons, ${totalEpisodes} episodes)`,
        value: show,
        short: show.title
      };
    });

    // Add navigation options
    choices.push(
      new inquirer.Separator(),
      { name: "🔍 Search again", value: "search_again" },
      { name: "❌ Exit", value: "exit" }
    );

    const showAnswer = await inquirer.prompt([
      {
        type: "list",
        name: "selectedShow",
        message: "Select a show:",
        choices: choices,
        pageSize: Math.min(process.stdout.rows - 8, 15),
        loop: false
      }
    ]);

    if (showAnswer.selectedShow === "search_again") {
      continue;
    } else if (showAnswer.selectedShow === "exit") {
      console.log('👋 Goodbye!');
      process.exit(0);
    } else {
      return showAnswer.selectedShow;
    }
  }
}

async function promptSeasonSelection(show) {
  /**
   * Select season to stream
   */
  console.clear();
  console.log(`\n📺 ${show.title}`);
  console.log('─'.repeat(show.title.length + 4));
  
  // Filter seasons with episodes
  const availableSeasons = show.seasons.filter(season => 
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
      pageSize: Math.min(process.stdout.rows - 6, 10),
      loop: false
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
      pageSize: 6,
      loop: false
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
      pageSize: Math.min(process.stdout.rows - 8, 12),
      loop: false
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

async function streamSeasonInMpv(season, showTitle) {
  /**
   * Stream entire season in mpv with actual stream URLs
   */
  try {
    // Get all stream URLs for the season
    const streamUrls = await getAllSeasonStreamUrls(season, showTitle);
    
    // Create mpv playlist
    const playlistPath = await createMpvPlaylist(streamUrls, showTitle, season.season_number);
    
    console.log(`\n🎬 Starting mpv with ${streamUrls.length} episodes...`);
    console.log('💡 mpv Controls:');
    console.log('   > or ENTER = Next episode');
    console.log('   < = Previous episode');
    console.log('   SPACE = Pause/Play');
    console.log('   Q = Quit');
    console.log('   F = Fullscreen\n');
    
    // Launch mpv with the playlist
    const mpv = spawn("mpv", [
      playlistPath,
      "--playlist-start=0",
      "--keep-open=yes",
      "--force-window=immediate",
      "--title=" + `${showTitle} - Season ${season.season_number}`
    ], { 
      stdio: "inherit" 
    });
    
    mpv.on("exit", (code) => {
      console.log(`\n🎬 mpv exited with code ${code}`);
      
      // Clean up playlist file
      try {
        fs.unlinkSync(playlistPath);
        console.log('🗑️  Playlist file cleaned up');
      } catch (err) {
        console.warn('⚠️  Could not clean up playlist file:', err.message);
      }
      
      process.exit(code);
    });
    
    mpv.on("error", (error) => {
      console.error('❌ Error starting mpv:', error.message);
      console.log('💡 Make sure mpv is installed: https://mpv.io/installation/');
    });
    
  } catch (error) {
    console.error('❌ Error streaming season:', error.message);
  }
}

async function streamEpisodeInMpv(episode, showTitle) {
  /**
   * Stream a single episode in mpv with enhanced URL extraction
   */
  try {
    console.log(`\n🔄 Preparing S${episode.season_id}E${episode.episode_id} - ${episode.title}...`);
    console.log('Extracting stream URL from available sources...\n');
    
    // Get the actual stream URL for the episode
    const streamUrl = await getActualStreamUrl(
      episode.show_id, 
      episode.season_id, 
      episode.episode_id
    );
    
    if (!streamUrl) {
      console.error(`❌ Could not find a working stream URL for this episode.`);
      console.log(`💡 This could be because:`);
      console.log(`   • The episode is not available on the streaming source`);
      console.log(`   • The source website has changed its structure`);
      console.log(`   • Temporary network issues\n`);
      
      const retryAnswer = await inquirer.prompt([
        {
          type: "confirm",
          name: "retry",
          message: "Would you like to try a different episode?",
          default: true
        }
      ]);
      
      if (!retryAnswer.retry) {
        return;
      } else {
        throw new Error("RETRY_EPISODE_SELECTION");
      }
    }
    
    console.log(`\n🎬 Starting mpv for S${episode.season_id}E${episode.episode_id}...`);
    console.log('💡 mpv Controls:');
    console.log('   SPACE = Pause/Play');
    console.log('   Q = Quit');
    console.log('   F = Fullscreen\n');
    
    // Launch mpv with the single episode URL
    const mpv = spawn("mpv", [
      streamUrl,
      "--keep-open=yes",
      "--force-window=immediate",
      "--title=" + `${showTitle} - S${episode.season_id}E${episode.episode_id} - ${episode.title}`
    ], { 
      stdio: "inherit" 
    });
    
    mpv.on("exit", (code) => {
      console.log(`\n🎬 mpv exited with code ${code}`);
      process.exit(code);
    });
    
    mpv.on("error", (error) => {
      console.error('❌ Error starting mpv:', error.message);
      console.log('💡 Make sure mpv is installed: https://mpv.io/installation/');
    });
    
  } catch (error) {
    console.error('❌ Error streaming episode:', error.message);
  }
}

async function showStartupMenu() {
  /**
   * Show startup menu with advanced options
   */
  console.clear();
  console.log('\n🎬 TrpTv Streaming CLI');
  console.log('═════════════════════\n');
  
  const cacheInfo = Object.keys(workingShowsCache).length;
  const menuChoices = [
    { name: "🎯 Search & Watch Shows", value: "search" },
    new inquirer.Separator(),
    { 
      name: `🔧 Advanced: Bulk test all shows (${cacheInfo} shows cached)`, 
      value: "bulk_test" 
    },
    { name: "❌ Exit", value: "exit" }
  ];

  const answer = await inquirer.prompt([
    {
      type: "list",
      name: "action",
      message: "What would you like to do?",
      choices: menuChoices
    }
  ]);

  return answer.action;
}

async function main() {
  /**
   * Main application loop with startup menu
   */
  try {
    // Ensure clean terminal start
    console.clear();
    
    // Show startup menu
    const startupAction = await showStartupMenu();
    
    if (startupAction === "exit") {
      console.log('👋 Goodbye!');
      process.exit(0);
    } else if (startupAction === "bulk_test") {
      await bulkTestAllShows();
      // After bulk test, return to main menu
      return main();
    }
    
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
              await streamSeasonInMpv(selectedSeason, selectedShow.title);
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
                  await streamEpisodeInMpv(selectedEpisode, selectedShow.title);
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