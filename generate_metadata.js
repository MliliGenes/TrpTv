#!/usr/bin/env node
/**
 * Generate Metadata - Extract lightweight metadata from full cartoons data
 * Creates a fast-loading metadata JSON for search and listing purposes
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// File paths
const FULL_DATA_FILE = path.join(__dirname, 'cartoons_data.json');
const METADATA_FILE = path.join(__dirname, 'cartoons_metadata.json');
const BACKUP_METADATA_FILE = path.join(__dirname, 'cartoons_metadata.backup.json');

/**
 * Extract metadata from a single show
 */
function extractShowMetadata(show) {
  // Calculate statistics
  const totalSeasons = show.seasons ? show.seasons.length : 0;
  const availableSeasons = show.seasons ? 
    show.seasons.filter(season => season.episodes && season.episodes.length > 0) : [];
  
  const totalEpisodes = show.seasons ? 
    show.seasons.reduce((total, season) => 
      total + (season.episodes ? season.episodes.length : 0), 0
    ) : 0;

  // Extract basic season info
  const seasonsInfo = availableSeasons.map(season => ({
    season_number: season.season_number,
    episode_count: season.episodes ? season.episodes.length : 0,
    first_episode_id: season.episodes && season.episodes.length > 0 ? 
      season.episodes[0].show_id : null
  }));

  // Extract search terms for better indexing
  const searchTerms = [
    show.title.toLowerCase(),
    ...show.title.toLowerCase().split(' ').filter(word => word.length > 2),
    // Add year if available in URL or title
    ...(show.url ? extractYearFromUrl(show.url) : []),
    // Add genres if available
    ...(show.genres ? show.genres.map(g => g.toLowerCase()) : [])
  ].filter((term, index, arr) => arr.indexOf(term) === index); // Remove duplicates

  return {
    title: show.title,
    url: show.url,
    total_seasons: totalSeasons,
    available_seasons: availableSeasons.length,
    total_episodes: totalEpisodes,
    seasons_info: seasonsInfo,
    search_terms: searchTerms,
    last_updated: new Date().toISOString(),
    // Store show_id from first available episode for streaming
    show_id: seasonsInfo.length > 0 ? seasonsInfo[0].first_episode_id : null
  };
}

/**
 * Extract year from URL or title
 */
function extractYearFromUrl(url) {
  const yearMatch = url.match(/(\d{4})/);
  return yearMatch ? [yearMatch[1]] : [];
}

/**
 * Generate search index for faster lookups
 */
function generateSearchIndex(metadata) {
  const index = {
    by_title: {},
    by_letter: {},
    by_episode_count: {
      '1-10': [],
      '11-25': [],
      '26-50': [],
      '51-100': [],
      '100+': []
    },
    by_season_count: {
      '1': [],
      '2-3': [],
      '4-5': [],
      '6+': []
    },
    popular_shows: [], // Shows with most episodes
    search_terms: {}
  };

  metadata.forEach((show, idx) => {
    // Index by exact title
    index.by_title[show.title.toLowerCase()] = idx;

    // Index by first letter
    const firstLetter = show.title[0].toUpperCase();
    if (!index.by_letter[firstLetter]) {
      index.by_letter[firstLetter] = [];
    }
    index.by_letter[firstLetter].push(idx);

    // Index by episode count
    const episodeCount = show.total_episodes;
    if (episodeCount <= 10) {
      index.by_episode_count['1-10'].push(idx);
    } else if (episodeCount <= 25) {
      index.by_episode_count['11-25'].push(idx);
    } else if (episodeCount <= 50) {
      index.by_episode_count['26-50'].push(idx);
    } else if (episodeCount <= 100) {
      index.by_episode_count['51-100'].push(idx);
    } else {
      index.by_episode_count['100+'].push(idx);
    }

    // Index by season count
    const seasonCount = show.available_seasons;
    if (seasonCount === 1) {
      index.by_season_count['1'].push(idx);
    } else if (seasonCount <= 3) {
      index.by_season_count['2-3'].push(idx);
    } else if (seasonCount <= 5) {
      index.by_season_count['4-5'].push(idx);
    } else {
      index.by_season_count['6+'].push(idx);
    }

    // Index search terms
    show.search_terms.forEach(term => {
      if (!index.search_terms[term]) {
        index.search_terms[term] = [];
      }
      index.search_terms[term].push(idx);
    });
  });

  // Generate popular shows (top 50 by episode count)
  const showsWithEpisodes = metadata
    .map((show, idx) => ({ show, idx, episodes: show.total_episodes }))
    .filter(item => item.episodes > 0)
    .sort((a, b) => b.episodes - a.episodes)
    .slice(0, 50);
  
  index.popular_shows = showsWithEpisodes.map(item => item.idx);

  return index;
}

/**
 * Main metadata generation function
 */
async function generateMetadata() {
  try {
    console.log('🚀 Starting metadata generation...');
    console.log('─'.repeat(50));

    // Check if full data file exists
    if (!fs.existsSync(FULL_DATA_FILE)) {
      throw new Error(`Full data file not found: ${FULL_DATA_FILE}`);
    }

    // Backup existing metadata if it exists
    if (fs.existsSync(METADATA_FILE)) {
      console.log('💾 Backing up existing metadata...');
      fs.copyFileSync(METADATA_FILE, BACKUP_METADATA_FILE);
      console.log('✅ Backup created');
    }

    // Load full cartoons data
    console.log('📚 Loading full cartoons data...');
    const startTime = Date.now();
    
    const stats = fs.statSync(FULL_DATA_FILE);
    const fileSizeKB = Math.round(stats.size / 1024);
    console.log(`   File size: ${fileSizeKB}KB`);

    const rawData = fs.readFileSync(FULL_DATA_FILE, 'utf8');
    const fullData = JSON.parse(rawData);

    const loadTime = Date.now() - startTime;
    console.log(`✅ Loaded full data in ${loadTime}ms`);

    if (!fullData.cartoons || !Array.isArray(fullData.cartoons)) {
      throw new Error('Invalid data format: missing or invalid cartoons array');
    }

    // Extract metadata
    console.log('🔍 Extracting metadata...');
    const extractStartTime = Date.now();
    
    const metadata = fullData.cartoons.map((show, index) => {
      if (index % 100 === 0) {
        process.stdout.write(`\r   Processing show ${index + 1}/${fullData.cartoons.length}...`);
      }
      return extractShowMetadata(show);
    });

    const extractTime = Date.now() - extractStartTime;
    console.log(`\n✅ Extracted metadata for ${metadata.length} shows in ${extractTime}ms`);

    // Generate search index
    console.log('📊 Generating search index...');
    const indexStartTime = Date.now();
    const searchIndex = generateSearchIndex(metadata);
    const indexTime = Date.now() - indexStartTime;
    console.log(`✅ Generated search index in ${indexTime}ms`);

    // Calculate statistics
    const stats_data = {
      total_shows: metadata.length,
      total_episodes: metadata.reduce((sum, show) => sum + show.total_episodes, 0),
      total_seasons: metadata.reduce((sum, show) => sum + show.available_seasons, 0),
      shows_with_episodes: metadata.filter(show => show.total_episodes > 0).length,
      avg_episodes_per_show: Math.round(
        metadata.reduce((sum, show) => sum + show.total_episodes, 0) / metadata.length
      ),
      most_episodes: Math.max(...metadata.map(show => show.total_episodes)),
      generation_time: new Date().toISOString()
    };

    // Create final metadata object
    const metadataObject = {
      version: "1.0.0",
      generated_at: new Date().toISOString(),
      source_file: path.basename(FULL_DATA_FILE),
      statistics: stats_data,
      shows: metadata,
      search_index: searchIndex
    };

    // Save metadata file
    console.log('💾 Saving metadata file...');
    const saveStartTime = Date.now();
    
    const metadataJson = JSON.stringify(metadataObject, null, 2);
    fs.writeFileSync(METADATA_FILE, metadataJson);
    
    const saveTime = Date.now() - saveStartTime;
    const metadataSize = Math.round(Buffer.byteLength(metadataJson, 'utf8') / 1024);
    
    console.log(`✅ Metadata saved in ${saveTime}ms`);
    console.log(`📁 File: ${path.basename(METADATA_FILE)} (${metadataSize}KB)`);

    // Show compression ratio
    const compressionRatio = ((fileSizeKB - metadataSize) / fileSizeKB * 100).toFixed(1);
    console.log(`📉 Size reduction: ${compressionRatio}% (${fileSizeKB}KB → ${metadataSize}KB)`);

    // Show generation summary
    console.log('\n📊 Generation Summary:');
    console.log('─'.repeat(50));
    console.log(`Total Shows: ${stats_data.total_shows}`);
    console.log(`Total Episodes: ${stats_data.total_episodes}`);
    console.log(`Total Seasons: ${stats_data.total_seasons}`);
    console.log(`Shows with Episodes: ${stats_data.shows_with_episodes}`);
    console.log(`Average Episodes per Show: ${stats_data.avg_episodes_per_show}`);
    console.log(`Most Episodes in a Show: ${stats_data.most_episodes}`);
    console.log(`Popular Shows Indexed: ${searchIndex.popular_shows.length}`);
    
    const totalTime = Date.now() - startTime;
    console.log(`\n⏱️  Total Generation Time: ${totalTime}ms`);
    console.log('✨ Metadata generation complete!');

    return metadataObject;

  } catch (error) {
    console.error('\n❌ Error generating metadata:', error.message);
    
    // Restore backup if generation failed and backup exists
    if (fs.existsSync(BACKUP_METADATA_FILE)) {
      console.log('🔄 Restoring backup metadata...');
      try {
        fs.copyFileSync(BACKUP_METADATA_FILE, METADATA_FILE);
        console.log('✅ Backup restored');
      } catch (restoreError) {
        console.error('❌ Failed to restore backup:', restoreError.message);
      }
    }
    
    process.exit(1);
  }
}

/**
 * Validate generated metadata
 */
function validateMetadata(metadata) {
  const issues = [];
  
  if (!metadata.shows || !Array.isArray(metadata.shows)) {
    issues.push('Missing or invalid shows array');
  }
  
  if (!metadata.search_index) {
    issues.push('Missing search index');
  }
  
  if (!metadata.statistics) {
    issues.push('Missing statistics');
  }
  
  // Check for shows without titles
  const showsWithoutTitles = metadata.shows.filter(show => !show.title || show.title.trim() === '');
  if (showsWithoutTitles.length > 0) {
    issues.push(`${showsWithoutTitles.length} shows without titles`);
  }
  
  // Check for shows without episodes
  const showsWithoutEpisodes = metadata.shows.filter(show => show.total_episodes === 0);
  if (showsWithoutEpisodes.length > 0) {
    console.log(`⚠️  Warning: ${showsWithoutEpisodes.length} shows have no episodes`);
  }
  
  return issues;
}

// CLI interface
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
📺 Cartoons Metadata Generator

Usage: node generate_metadata.js [options]

Options:
  --help, -h     Show this help message
  --validate, -v Validate existing metadata file
  --stats, -s    Show statistics about existing metadata
  --force, -f    Force regeneration even if metadata is newer than source

Examples:
  node generate_metadata.js              # Generate metadata
  node generate_metadata.js --validate   # Validate existing metadata
  node generate_metadata.js --stats      # Show metadata statistics
`);
    process.exit(0);
  }
  
  if (args.includes('--validate') || args.includes('-v')) {
    if (fs.existsSync(METADATA_FILE)) {
      try {
        const metadata = JSON.parse(fs.readFileSync(METADATA_FILE, 'utf8'));
        const issues = validateMetadata(metadata);
        
        if (issues.length === 0) {
          console.log('✅ Metadata file is valid');
          console.log(`📊 ${metadata.shows.length} shows, ${metadata.statistics.total_episodes} episodes`);
        } else {
          console.log('❌ Metadata validation failed:');
          issues.forEach(issue => console.log(`   - ${issue}`));
          process.exit(1);
        }
      } catch (error) {
        console.error('❌ Error validating metadata:', error.message);
        process.exit(1);
      }
    } else {
      console.log('❌ Metadata file not found');
      process.exit(1);
    }
    process.exit(0);
  }
  
  if (args.includes('--stats') || args.includes('-s')) {
    if (fs.existsSync(METADATA_FILE)) {
      try {
        const metadata = JSON.parse(fs.readFileSync(METADATA_FILE, 'utf8'));
        console.log('📊 Metadata Statistics:');
        console.log('─'.repeat(30));
        Object.entries(metadata.statistics).forEach(([key, value]) => {
          const label = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
          console.log(`${label}: ${value}`);
        });
      } catch (error) {
        console.error('❌ Error reading metadata:', error.message);
        process.exit(1);
      }
    } else {
      console.log('❌ Metadata file not found');
      process.exit(1);
    }
    process.exit(0);
  }
  
  // Check if metadata is newer than source (unless --force)
  if (!args.includes('--force') && !args.includes('-f')) {
    if (fs.existsSync(METADATA_FILE)) {
      const metadataStats = fs.statSync(METADATA_FILE);
      const sourceStats = fs.statSync(FULL_DATA_FILE);
      
      if (metadataStats.mtime > sourceStats.mtime) {
        console.log('ℹ️  Metadata is already up to date');
        console.log('   Use --force to regenerate anyway');
        process.exit(0);
      }
    }
  }
  
  // Generate metadata
  generateMetadata().then(() => {
    console.log('\n🎉 Ready to use with TrpTv!');
  });
}