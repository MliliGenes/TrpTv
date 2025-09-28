#!/usr/bin/env node
/**
 * TV Shows CLI - Search shows and stream entire seasons in mpv
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
   * Extract the actual 123moviespremium.net stream URL
   * This is the URL that the browser makes GET requests to
   */
  const baseUrl = `https://stevenuniverse.best/video-player/?idd=${idd}&season=${season}&episode=${episode}`;
  const referer = "https://stevenuniverse.best";

  try {
    console.log(`🔍 Extracting stream URL for S${season}E${episode}...`);
    
    // Step 1: Fetch the video player page
    const { data: html } = await axios.get(baseUrl, {
      headers: { ...HEADERS, "Referer": referer },
      timeout: 15000
    });

    // Step 2: Extract the 123moviespremium.net watch URL
    const $ = cheerio.load(html);
    let watchUrl = null;
    
    // Look in iframes, scripts, and links for the watch URL
    $("iframe, script, a").each((_, el) => {
      const attr = $(el).attr("src") || $(el).attr("href") || $(el).text();
      if (attr && attr.includes("123moviespremium.net/watch/")) {
        watchUrl = attr.replace(/&amp;/g, "&");
        return false; // Break the loop
      }
    });

    if (!watchUrl) {
      console.warn(`⚠️  No 123moviespremium watch URL found for S${season}E${episode}`);
      return null;
    }

    console.log(`✅ Found stream URL: ${watchUrl.substring(0, 60)}...`);
    return watchUrl;

  } catch (error) {
    console.error(`❌ Error getting stream URL for S${season}E${episode}:`, error.message);
    return null;
  }
}

function searchShows(query) {
  /**
   * Search shows with dynamic filtering
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
   * Interactive show search with dynamic results
   */
  console.log('\n🎬 TV Shows Streaming CLI');
  console.log('═══════════════════════════\n');

  while (true) {
    const searchAnswer = await inquirer.prompt([
      {
        type: "input",
        name: "search",
        message: "🔍 Search TV shows (or press Enter to browse):",
      }
    ]);

    const results = searchShows(searchAnswer.search);
    
    if (results.length === 0) {
      console.log('❌ No shows found. Try a different search term.');
      continue;
    }

    console.log(`\n📺 Found ${results.length} show(s):`);
    
    // Prepare choices with episode counts
    const choices = results.slice(0, 15).map(show => {
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
        pageSize: 12
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
  console.log(`\n📺 ${show.title}`);
  console.log('─'.repeat(show.title.length + 4));
  
  // Filter seasons with episodes
  const availableSeasons = show.seasons.filter(season => 
    season.episodes && season.episodes.length > 0
  );
  
  if (availableSeasons.length === 0) {
    console.log('❌ No episodes available for this show.');
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
      choices: seasonChoices
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
      ]
    }
  ]);

  return watchAnswer.watchType;
}

async function promptEpisodeSelection(season) {
  /**
   * Select a specific episode from the season
   */
  console.log(`\n📺 Season ${season.season_number} Episodes`);
  console.log('─'.repeat(`Season ${season.season_number} Episodes`.length + 2));
  
  const episodeChoices = season.episodes.map(episode => ({
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
      pageSize: 10
    }
  ]);

  return episodeAnswer.selectedEpisode;
}

async function getAllSeasonStreamUrls(season, showTitle) {
  /**
   * Extract actual stream URLs for all episodes in a season
   */
  console.log(`\n🔄 Preparing ${season.episodes.length} episodes from Season ${season.season_number}...`);
  console.log('This may take a moment as we extract the real stream URLs...\n');
  
  const streamUrls = [];
  const total = season.episodes.length;
  
  for (let i = 0; i < season.episodes.length; i++) {
    const episode = season.episodes[i];
    const progress = `[${i + 1}/${total}]`;
    
    process.stdout.write(`\r${progress} Processing "${episode.title}"...`);
    
    // Extract the actual 123moviespremium.net stream URL
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
    } else {
      console.log(`\n⚠️  Failed to get stream URL for episode ${episode.episode_id}`);
    }
    
    // Small delay to be respectful to the server
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log(`\n\n✅ Successfully prepared ${streamUrls.length}/${total} episodes`);
  
  if (streamUrls.length === 0) {
    throw new Error("No valid stream URLs found for this season");
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
   * Stream a single episode in mpv with actual stream URL
   */
  try {
    console.log(`\n🔄 Preparing S${episode.season_id}E${episode.episode_id} - ${episode.title}...`);
    console.log('This may take a moment as we extract the real stream URL...\n');
    
    // Get the actual stream URL for the episode
    const streamUrl = await getActualStreamUrl(
      episode.show_id, 
      episode.season_id, 
      episode.episode_id
    );
    
    if (!streamUrl) {
      throw new Error("Failed to get stream URL for this episode");
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

async function main() {
  /**
   * Main application loop
   */
  try {
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
                await streamEpisodeInMpv(selectedEpisode, selectedShow.title);
                return; // Exit after streaming
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