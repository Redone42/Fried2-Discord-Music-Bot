# 🎵 Fried² - Discord Music Bot

> A self-hosted, multi-guild music bot for Discord. Stream audio from YouTube directly into voice channels, manage queues, save personal playlists, and control playback with interactive buttons.

[![Discord.js](https://img.shields.io/badge/discord.js-v14-blue?style=for-the-badge&logo=discord)](https://discord.js.org/)
[![Node.js](https://img.shields.io/badge/Node.js-v18+-green?style=for-the-badge&logo=node.js)](https://nodejs.org/)

---

## ✨ Core Features

| Feature | Description |
|---------|-------------|
| 🎵 **Playback** | Stream audio from YouTube URLs, search terms, or playlists with low-latency yt-dlp piping |
| 📋 **Queue Management** | Add, remove, skip, shuffle, and reorder songs. Play-next support to jump the queue |
| 🔄 **Loop Modes** | Three modes: off, single-song repeat, or full queue loop — toggled per guild |
| ⏮️ **Song History** | Go back to previously played tracks with the `!prev` command |
| 💾 **Saved Playlists** | Per-user playlists stored as JSON. Create, add, remove, and play them anytime |
| 🎤 **Lyrics Lookup** | Fetches song metadata and Genius links for currently playing tracks |

---

## 🎮 Interactive Controls

Every now-playing message includes persistent buttons for full playback control:

- **⏮️ Previous** - Go back to the last song
- **⏸️ Pause/Resume** - Control playback
- **⏭️ Skip** - Play next song
- **⏹️ Stop** - Stop playback and leave channel
- **🔀 Shuffle** - Randomize queue
- **🔁 Loop** - Cycle loop modes
- **📋 Queue** - View full queue
- **📝 Lyrics** - Get song info
- **🗑️ Clear** - Clear the queue

Buttons update live and disable automatically when nothing is playing.

---

## 📝 Commands

```
/play <query>              Play a YouTube URL, search term, or saved playlist
/playnext <query>          Add song to play immediately after current
/skip                      Skip the currently playing song
/prev or /previous          Go back to the last played song
/stop                      Stop playback and leave the channel
/queue or /q                Show the full current queue
/shuffle                   Randomly shuffle the queue (keeps current song)
/loop [off/single/queue]   Set or cycle through loop modes
/nowplaying or /np          Show the now-playing card with all controls
/clear                     Clear the queue without stopping current song
/remove <#>                Remove a specific song from queue by position
/lyrics [query]            Get Genius song info for current or searched song
/playlist <sub>            Manage saved playlists (create/add/list/show/delete/remove)
```

---

## 🛠️ Tech Stack

- **Runtime**: Node.js
- **Discord Library**: discord.js v14
- **Voice**: @discordjs/voice
- **Audio Extraction**: yt-dlp-exec
- **HTTP Client**: axios
- **API**: Genius REST API
- **Config**: dotenv
- **Storage**: JSON (fs)

---

## 🏗️ Architecture

- **Multi-Guild Support** - All state (players, queues, connections, loop modes, history, playlists) is scoped per guild ID
- **Efficient Streaming** - Audio streamed directly from yt-dlp as a piped process — no intermediate file downloads
- **Persistent Storage** - Playlists stored to `user_playlists.json` on disk, loaded at startup
- **Low Latency** - Optimized for real-time playback with minimal delay

---

## 📦 Installation

1. Clone the repository:
```bash
git clone https://github.com/Redone42/Fried2-Discord-Music-Bot.git
cd Fried2-Discord-Music-Bot
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file in the root directory:
```
DISCORD_TOKEN=your_bot_token_here
CLIENT_ID=your_client_id_here
GENIUS_TOKEN=your_genius_token_here
```

4. Deploy commands:
```bash
npm run deploy
```

5. Start the bot:
```bash
npm start
```

---

## 🚀 Quick Start

### Add the bot to your server:
[![Invite Fried²](https://img.shields.io/badge/Invite_Bot-Click_Here-7289DA?style=for-the-badge&logo=discord)](https://discord.com/oauth2/authorize?client_id=1412780874474197102&scope=bot+applications.commands&permissions=2150647808)

### Start playing music:
1. Join a voice channel
2. Type `/help ` to access all command
3. Type `/play <song name>` to start playing music
4. Use the buttons or commands to control playback

---

## 📧 Support

For issues, feature requests, or questions, feel free to open an issue on GitHub!
Email: faridmuham9@gmail.com

---

**Made with ❤️ by [Farid](https://github.com/Redone42)**
