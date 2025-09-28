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



function searchShows(query) {
  /**
   * Search shows with simple filtering
   */
  if (!query || query.trim().length === 0) {
    return showsData.cartoons.slice(0, 20); // Show first 20 if no search
  }
  
  const searchTerm = query.toLowerCase().trim();
  return showsData.cartoons.filter(show => 
    show.title.toLowerCase().includes(searchTerm)
  );
}

async function promptShowSearch() {
  /**
   * Interactive show search with simple results
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

    const results = searchShows(searchAnswer.search);
    
    if (results.length === 0) {
      console.log('\n❌ No shows found. Try a different search term.\n');
      continue;
    }

    // Clear and show results
    console.clear();
    console.log('\n🎬 TrpTv Streaming CLI');
    console.log('═════════════════════\n');
    console.log(`📺 Found ${results.length} show(s):\n`);
    
    // Prepare choices with episode counts
    const choices = results.slice(0, 20).map(show => {
      const totalEpisodes = show.seasons.reduce((total, season) => 
        total + (season.episodes ? season.episodes.length : 0), 0
      );
      const availableSeasons = show.seasons.filter(s => s.episodes && s.episodes.length > 0).length;
      
      return {
        name: `${show.title} (${availableSeasons} seasons, ${totalEpisodes} episodes)`,
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

async function streamSeasonInMpv(idd, seasonData, seasonNumber) {
  /**
   * Stream all episodes of a season in sequence
   */
  const episodes = seasonData.episodes;
  console.log(`🔄 Preparing ${episodes.length} episodes from Season ${seasonNumber}...`);
  console.log("This may take a moment as we extract the real stream URLs...\n");

  let browserEpisodes = [];
  let mpvEpisodes = [];

  // First, categorize episodes by streaming method
  for (let i = 0; i < episodes.length; i++) {
    const episode = episodes[i];
    console.log(`[${i + 1}/${episodes.length}] Processing "${episode.title}"...`);
    
    const streamResult = await getActualStreamUrl(idd, seasonNumber, episode.episode);
    
    if (!streamResult) {
      console.log(`⚠️  Failed to get stream URL for episode ${episode.episode}`);
      continue;
    }
    
    if (typeof streamResult === 'object' && streamResult.requiresBrowser) {
      browserEpisodes.push({
        episode: episode,
        url: streamResult.url
      });
    } else {
      mpvEpisodes.push({
        episode: episode,
        url: typeof streamResult === 'string' ? streamResult : streamResult.url
      });
    }
  }

  // Handle browser episodes first (if any)
  if (browserEpisodes.length > 0) {
    console.log(`\n🌐 Found ${browserEpisodes.length} episodes that require browser playback:`);
    for (const item of browserEpisodes) {
      console.log(`   Episode ${item.episode.episode}: ${item.episode.title}`);
      console.log(`   URL: ${item.url}`);
    }
    console.log(`\n💡 Please open these URLs manually in your browser.`);
    
    if (mpvEpisodes.length > 0) {
      console.log(`\n🎬 Continuing with ${mpvEpisodes.length} episodes that can be played in mpv...\n`);
    }
  }

  // Play mpv episodes in sequence
  for (let i = 0; i < mpvEpisodes.length; i++) {
    const item = mpvEpisodes[i];
    console.log(`🎬 Playing Episode ${item.episode.episode}: ${item.episode.title}...`);
    console.log(`� mpv Controls: SPACE = Pause/Play | Q = Quit | F = Fullscreen\n`);
    
    const mpvProcess = spawn("mpv", [item.url], { stdio: "inherit" });
    
    const playResult = await new Promise((resolve) => {
      mpvProcess.on("close", (code) => {
        resolve(code);
      });
    });
    
    if (playResult !== 0) {
      console.log(`\n⚠️  Episode ended unexpectedly (code ${playResult}). Continuing to next episode...\n`);
    } else {
      console.log(`\n✅ Episode ${item.episode.episode} completed successfully!\n`);
    }
  }
  
  console.log(`🎉 Season ${seasonNumber} processing complete!`);
  if (browserEpisodes.length > 0) {
    console.log(`📝 Remember to watch the ${browserEpisodes.length} browser episodes listed above.`);
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