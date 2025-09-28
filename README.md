# TV Shows CLI Streamer 📺

A command-line interface for searching and streaming TV shows and cartoons directly in mpv player. Extracts actual stream URLs from 123moviespremium.net for seamless viewing.

## ✨ Features

- 🔍 **Interactive Search**: Search through a curated collection of TV shows and cartoons
- 📺 **Flexible Viewing**: Watch either single episodes or entire seasons
- 🎬 **Direct Streaming**: Stream directly in mpv with extracted URLs
- 📱 **User-Friendly Interface**: Intuitive CLI with navigation and controls
- 🔄 **Auto-Playlist**: Automatically creates playlists for season viewing
- 🎯 **Episode Selection**: Browse and select specific episodes with titles
- 🧹 **Clean Playback**: Automatic cleanup of temporary playlist files

## 🛠️ Installation

### Prerequisites

- **Node.js** (v14 or higher)
- **Python** (3.7 or higher) 
- **mpv player** - [Installation Guide](https://mpv.io/installation/)

### Setup

1. **Clone the repository**:
   ```bash
   git clone <repository-url>
   cd tv
   ```

2. **Install Node.js dependencies**:
   ```bash
   npm install
   ```

3. **Install Python dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

4. **Make the CLI executable**:
   ```bash
   chmod +x tv_cli.js
   ```

## 🚀 Usage

### Basic Usage

Run the TV CLI:
```bash
node tv_cli.js
# or if made executable:
./tv_cli.js
```

### Navigation Flow

1. **Search Shows**: Enter search terms or browse available shows
2. **Select Show**: Choose from search results
3. **Select Season**: Pick the season you want to watch
4. **Choose Option**: 
   - 📺 Watch one episode
   - 🎬 Watch entire season
5. **Enjoy**: mpv will launch with your selection

### mpv Controls

- **SPACE**: Pause/Play
- **Q**: Quit
- **F**: Fullscreen
- **> or ENTER**: Next episode (season mode)
- **<**: Previous episode (season mode)

## 📁 Project Structure

```
tv/
├── tv_cli.js              # Main CLI application
├── watch.js               # Watch functionality module
├── scrape_episodes.py     # Episode data scraper
├── add_watch_urls.py      # URL extraction utility
├── cartoons_data.json     # Show database
├── package.json           # Node.js dependencies
├── requirements.txt       # Python dependencies
├── scraper.log           # Scraping logs
├── watch_urls.log        # URL extraction logs
└── __pycache__/          # Python cache files
```

## 🔧 Development

### Data Management

The project includes Python scripts for data management:

- **scrape_episodes.py**: Scrapes episode data from source websites
- **add_watch_urls.py**: Adds streaming URLs to the database

### Updating Show Database

To refresh the show database:
```bash
python scrape_episodes.py
python add_watch_urls.py
```

### Adding New Shows

1. Update the scraping logic in `scrape_episodes.py`
2. Run the scraper to update `cartoons_data.json`
3. Extract stream URLs using `add_watch_urls.py`

## 🎯 Features Breakdown

### Search & Selection
- Dynamic search with instant results
- Show information with episode counts
- Season browsing with episode details

### Streaming Options
- **Single Episode**: Perfect for specific episodes or catching up
- **Full Season**: Binge-watch entire seasons with auto-progression
- **Stream URL Extraction**: Real-time extraction of working stream URLs

### User Experience
- Clean, emoji-enhanced interface
- Intuitive navigation with back options
- Progress indicators during URL extraction
- Automatic cleanup of temporary files

## 📋 Dependencies

### Node.js Packages
- `axios` - HTTP requests
- `cheerio` - HTML parsing
- `inquirer` - Interactive CLI prompts

### Python Packages
- `requests` - HTTP requests
- `beautifulsoup4` - HTML parsing
- `concurrent.futures` - Parallel processing

## ⚠️ Notes

- **mpv Required**: Make sure mpv is installed and accessible in PATH
- **Network Required**: Active internet connection needed for streaming
- **Source Dependency**: Relies on 123moviespremium.net for stream URLs
- **Rate Limiting**: Built-in delays to be respectful to source servers

## 🔒 Legal Notice

This tool is for educational purposes. Users are responsible for ensuring they have the right to access the content they stream. Respect copyright laws and terms of service.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📝 License

This project is provided as-is for educational purposes. Use responsibly and in accordance with applicable laws.

---

**Happy Streaming!** 🍿📺