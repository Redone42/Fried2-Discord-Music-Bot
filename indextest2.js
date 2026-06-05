require("dotenv").config();
const { 
  Client, 
  GatewayIntentBits, 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle,
  StringSelectMenuBuilder,
  ComponentType
} = require("discord.js");
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  NoSubscriberBehavior,
  AudioPlayerStatus,
  entersState,
  VoiceConnectionStatus,
  StreamType,
} = require("@discordjs/voice");
const ytdlp = require("yt-dlp-exec");
const axios = require("axios");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

const prefix = "!";

// ✅ Per-guild players instead of one global player
const players = new Map();

const queues = new Map();
const connections = new Map();
const loopModes = new Map();
const currentSongs = new Map();
const musicChannels = new Map();
const nowPlayingMessages = new Map();
const songHistory = new Map();
const activeStreams = new Map();

// ✅ Per-guild skipNextIdle instead of a global boolean
const skipNextIdle = new Set();

const GENIUS_ACCESS_TOKEN = process.env.GENIUS_API_KEY;
const GENIUS_API_BASE = "https://api.genius.com";

const YT_DLP_BASE_OPTIONS = {
  noWarnings: true,
  preferFreeFormats: true,
  noPlaylist: true,
  addHeader: [
    'User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  ],
  extractorArgs: 'youtube:player_client=android,web',
};

const YT_DLP_PLAYLIST_OPTIONS = {
  dumpSingleJson: true,
  flatPlaylist: true,
  noWarnings: true,
  ignoreErrors: true,
  addHeader: [
    'User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  ],
  extractorArgs: 'youtube:player_client=android,web',
};

// ============ PLAYLIST STORAGE FUNCTIONS ============
const fs = require("fs");
const path = require("path");

const PLAYLIST_FILE = path.join(__dirname, "user_playlists.json");

let userPlaylists = {};
if (fs.existsSync(PLAYLIST_FILE)) {
  try {
    const data = fs.readFileSync(PLAYLIST_FILE, "utf8");
    userPlaylists = JSON.parse(data);
    console.log(`✅ Loaded playlists for ${Object.keys(userPlaylists).length} users`);
  } catch (error) {
    console.error("Error loading playlists:", error);
    userPlaylists = {};
  }
}

function savePlaylists() {
  try {
    fs.writeFileSync(PLAYLIST_FILE, JSON.stringify(userPlaylists, null, 2), "utf8");
    return true;
  } catch (error) {
    console.error("Error saving playlists:", error);
    return false;
  }
}

async function getUserPlaylists(userId) {
  return userPlaylists[userId] || {};
}

async function saveUserPlaylists(userId, playlists) {
  userPlaylists[userId] = playlists;
  return savePlaylists();
}
// ============ END PLAYLIST STORAGE ===============

// ✅ Get or create a per-guild AudioPlayer with all its listeners bound to that guild
function getOrCreatePlayer(guildId) {
  if (players.has(guildId)) return players.get(guildId);

  const player = createAudioPlayer({
    behaviors: { noSubscriber: NoSubscriberBehavior.Pause },
  });

  player.on(AudioPlayerStatus.Idle, () => {
    // ✅ If playPrevious triggered the stop, skip this handler entirely
    if (skipNextIdle.has(guildId)) {
      skipNextIdle.delete(guildId);
      return;
    }

    console.log(`🔄 [${guildId}] Player status: Idle`);

    const queue = queues.get(guildId);
    const loopMode = loopModes.get(guildId) || 0;
    const currentSong = currentSongs.get(guildId);
    const musicChannel = musicChannels.get(guildId);

    if (!queue?.length && !currentSong) return;

    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;

    const vc = guild.members.me?.voice.channel;
    if (!vc) return;

    const dummy = {
      guild,
      channel: musicChannel || guild.systemChannel || guild.channels.cache.find((c) => c.isTextBased?.()),
    };

    // Save finished song to history (not when looping single song)
    if (currentSong && loopMode !== 1) {
      const history = songHistory.get(guildId) || [];
      history.push(currentSong);
      if (history.length > 50) history.shift();
      songHistory.set(guildId, history);
      console.log(`📚 [${guildId}] Saved to history: ${currentSong.title} (total: ${history.length})`);
    }

    if (loopMode === 1 && currentSong) {
      console.log(`🔂 [${guildId}] Looping current song`);
      playNext(vc, dummy);
      return;
    }

    if (queue.length > 0) {
      const finishedSong = queue.shift();
      if (loopMode === 2 && finishedSong) {
        console.log(`🔁 [${guildId}] Adding song back to queue (loop mode)`);
        queue.push(finishedSong);
      }
    }

    currentSongs.delete(guildId);
    updateNowPlayingMessage(guildId);

    if (queue.length > 0) {
      console.log(`▶️ [${guildId}] Playing next song from queue (${queue.length} remaining)`);
      playNext(vc, dummy);
    } else {
      console.log(`📭 [${guildId}] Queue empty`);
      const connection = connections.get(guildId);
      if (connection && loopMode === 0) {
        setTimeout(() => {
          if (connection.state.status !== VoiceConnectionStatus.Destroyed) {
            console.log(`👋 [${guildId}] Leaving voice channel (queue finished)`);
            connection.destroy();
            connections.delete(guildId);
            musicChannels.delete(guildId);
            players.delete(guildId);
            updateNowPlayingMessage(guildId);
          }
        }, 5000);
      }
    }
  });

  player.on("error", (error) => {
    console.error(`❌ [${guildId}] AudioPlayer error:`, error.message);

    const queue = queues.get(guildId);
    const musicChannel = musicChannels.get(guildId);
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;

    if (queue?.length > 0) {
      queue.shift();
      currentSongs.delete(guildId);
      updateNowPlayingMessage(guildId);

      const vc = guild.members.me?.voice.channel;
      if (vc && queue.length > 0) {
        const dummy = {
          guild,
          channel: musicChannel || guild.systemChannel || guild.channels.cache.find((c) => c.isTextBased?.()),
        };
        console.log(`⏭️ [${guildId}] Skipping to next song after error`);
        setTimeout(() => playNext(vc, dummy), 2000);
      }
    }
  });

  player.on(AudioPlayerStatus.Playing, () => {
    console.log(`▶️ [${guildId}] Player status: Playing`);
  });

  player.on(AudioPlayerStatus.Paused, () => {
    console.log(`⏸️ [${guildId}] Player status: Paused`);
  });

  player.on(AudioPlayerStatus.Buffering, () => {
    console.log(`⏳ [${guildId}] Player status: Buffering`);
  });

  player.on('stateChange', (oldState, newState) => {
    console.log(`🔄 [${guildId}] Player state: ${oldState.status} → ${newState.status}`);
  });

  players.set(guildId, player);
  return player;
}

function createMusicControls(guildId, disabled = false) {
  const loopMode = loopModes.get(guildId) || 0;
  const loopEmojis = ["🔁", "🔂", "🔁"];
  const loopLabels = ["Loop: Off", "Loop: Song", "Loop: Queue"];
  
  const row1 = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('music_previous')
        .setEmoji('⏮️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId('music_play_pause')
        .setEmoji('⏸️')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId('music_skip')
        .setEmoji('⏭️')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId('music_stop')
        .setEmoji('⏹️')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId('music_shuffle')
        .setEmoji('🔀')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled)
    );

  const row2 = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('music_loop')
        .setEmoji(loopEmojis[loopMode])
        .setLabel(loopLabels[loopMode])
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId('music_queue')
        .setEmoji('📋')
        .setLabel('Queue')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId('music_lyrics')
        .setEmoji('📝')
        .setLabel('Lyrics')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId('music_clear')
        .setEmoji('🗑️')
        .setLabel('Clear Queue')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled)
    );

  return [row1, row2];
}

async function updateNowPlayingMessage(guildId) {
  const msgData = nowPlayingMessages.get(guildId);
  if (!msgData) return;

  const current = currentSongs.get(guildId);
  const queue = queues.get(guildId) || [];
  const loopMode = loopModes.get(guildId) || 0;
  
  if (!current) {
    try {
      await msgData.message.edit({
        embeds: [new EmbedBuilder()
          .setColor(0xFF0000)
          .setTitle("🎵 Music Player")
          .setDescription("No song currently playing")],
        components: createMusicControls(guildId, true)
      });
    } catch (err) {
      console.error("Failed to update message:", err);
    }
    return;
  }

  const loopText = ["", "🔂", "🔁"][loopMode];
  
  const embed = new EmbedBuilder()
    .setColor(0x00FF00)
    .setTitle("🎵 Now Playing")
    .setDescription(`**${current.title}** ${loopText}`)
    .addFields(
      { name: "Duration", value: String(current.duration || "Unknown"), inline: true },
      { name: "Queue", value: `${queue.length} song(s)`, inline: true },
      { name: "Loop", value: ["Off", "Single", "Queue"][loopMode] || "Off", inline: true }
    )
    .setFooter({ text: "Use the buttons below to control playback" });

  try {
    await msgData.message.edit({
      embeds: [embed],
      components: createMusicControls(guildId, false)
    });
  } catch (err) {
    console.error("Failed to update message:", err);
  }
}

client.once("clientReady", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton() && !interaction.isStringSelectMenu()) return;

  const guildId = interaction.guild.id;
  const queue = queues.get(guildId) || [];
  const current = currentSongs.get(guildId);

  // ✅ Always get the guild-specific player
  const player = players.get(guildId);

  if (interaction.isButton()) {
    switch (interaction.customId) {
      case 'music_play_pause':
        if (!player) {
          await interaction.reply({ content: "⚠️ Nothing is playing", ephemeral: true });
          break;
        }
        if (player.state.status === AudioPlayerStatus.Playing) {
          player.pause();
          await interaction.reply({ content: "⏸️ Paused playback", ephemeral: true });
        } else if (player.state.status === AudioPlayerStatus.Paused) {
          player.unpause();
          await interaction.reply({ content: "▶️ Resumed playback", ephemeral: true });
        } else {
          await interaction.reply({ content: "⚠️ Nothing is playing", ephemeral: true });
        }
        break;

      case 'music_skip':
        if (!current || !player) {
          await interaction.reply({ content: "⚠️ Nothing is currently playing", ephemeral: true });
          return;
        }
        player.stop();
        await interaction.reply({ content: `⏭️ Skipped: **${current.title}**`, ephemeral: true });
        break;

      case 'music_previous': {
        const vc = interaction.member?.voice?.channel;
        if (!vc) {
          await interaction.reply({ content: "⚠️ Join a voice channel first", ephemeral: true });
          return;
        }
        const history = songHistory.get(guildId) || [];
        if (!history.length) {
          await interaction.reply({ content: "⚠️ No previous songs in history.", ephemeral: true });
          return;
        }
        await interaction.reply({ content: "⏮️ Going to previous song...", ephemeral: true });
        await playPrevious(vc, { guild: interaction.guild, channel: interaction.channel });
        break;
      }

      case 'music_stop': {
        queues.set(guildId, []);
        currentSongs.delete(guildId);
        songHistory.delete(guildId);
        loopModes.set(guildId, 0);
        musicChannels.delete(guildId);
        const conn = connections.get(guildId);
        if (conn) {
          conn.destroy();
          connections.delete(guildId);
        }
        const stopStream = activeStreams.get(guildId);
        if (stopStream) { try { stopStream.kill('SIGKILL'); } catch (_) {} activeStreams.delete(guildId); }
        if (player) {
          player.stop();
          players.delete(guildId);
        }
        await interaction.reply({ content: "⏹️ Stopped playback and cleared queue", ephemeral: true });
        await updateNowPlayingMessage(guildId);
        break;
      }

      case 'music_shuffle': {
        if (queue.length <= 1) {
          await interaction.reply({ content: "⚠️ Need at least 2 songs in queue to shuffle", ephemeral: true });
          return;
        }
        const rest = queue.slice(1);
        for (let i = rest.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [rest[i], rest[j]] = [rest[j], rest[i]];
        }
        queues.set(guildId, [queue[0], ...rest]);
        await interaction.reply({ content: "🔀 Queue shuffled!", ephemeral: true });
        break;
      }

      case 'music_loop': {
        const currentMode = loopModes.get(guildId) || 0;
        const newMode = (currentMode + 1) % 3;
        loopModes.set(guildId, newMode);
        const modes = ["🔁 Loop disabled", "🔂 Loop: Single song", "🔁 Loop: Entire queue"];
        await interaction.reply({ content: modes[newMode], ephemeral: true });
        await updateNowPlayingMessage(guildId);
        break;
      }

      case 'music_queue': {
        if (!queue.length && !current) {
          await interaction.reply({ content: "📭 Queue is empty", ephemeral: true });
          return;
        }

        let queueText = "";
        if (current) {
          const loopMode = loopModes.get(guildId) || 0;
          const loopText = ["", " 🔂", " 🔁"][loopMode];
          queueText += `**Now Playing:**\n▶️ ${current.title}${loopText}\n\n`;
        }

        if (queue.length > 0) {
          queueText += "**Up Next:**\n";
          const displayQueue = queue.slice(0, 10);
          displayQueue.forEach((song, index) => {
            queueText += `${index + 1}. ${song.title}\n`;
          });
          if (queue.length > 10) {
            queueText += `\n... and ${queue.length - 10} more songs`;
          }
        }

        const queueEmbed = new EmbedBuilder()
          .setColor(0xFFFF00)
          .setTitle("📋 Music Queue")
          .setDescription(queueText)
          .setFooter({ text: `Total songs in queue: ${queue.length}` });

        await interaction.reply({ embeds: [queueEmbed], ephemeral: true });
        break;
      }

      case 'music_lyrics': {
        if (!current) {
          await interaction.reply({ content: "⚠️ No song currently playing", ephemeral: true });
          return;
        }

        await interaction.deferReply({ ephemeral: true });
        
        try {
          const lyricsInfo = await searchLyrics(current.title);
          
          if (!lyricsInfo) {
            await interaction.editReply({ content: "❌ No lyrics found for this song" });
            return;
          }

          const lyricsEmbed = new EmbedBuilder()
            .setColor(0xFF1DB4)
            .setTitle("📝 Song Information")
            .setDescription(`**${lyricsInfo.title}**\nby ${lyricsInfo.artist}`)
            .addFields(
              { name: "Album", value: lyricsInfo.album || "Unknown", inline: true },
              { name: "Release Date", value: lyricsInfo.releaseDate || "Unknown", inline: true },
              { name: "View Full Lyrics", value: `[Click here to view on Genius](${lyricsInfo.url})`, inline: false }
            )
            .setThumbnail(lyricsInfo.thumbnail || null)
            .setFooter({ text: "Powered by Genius", iconURL: "https://images.genius.com/8ed669cadd956443e29c70361ec4f372.1000x1000x1.png" });

          await interaction.editReply({ embeds: [lyricsEmbed] });
        } catch (error) {
          console.error("Lyrics error:", error);
          await interaction.editReply({ content: "❌ Error searching for lyrics" });
        }
        break;
      }

      case 'music_clear':
        if (!queue.length) {
          await interaction.reply({ content: "⚠️ Queue is already empty", ephemeral: true });
          return;
        }
        queues.set(guildId, []);
        await interaction.reply({ content: "🗑️ Queue cleared!", ephemeral: true });
        break;
    }
  }
});

client.on("messageCreate", async (message) => {
  if (message.author.bot || !message.content.startsWith(prefix)) return;

  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const command = args.shift()?.toLowerCase();
  const guildId = message.guild.id;

  if (command === "help") {
    const embed = new EmbedBuilder()
      .setColor(0x0099FF)
      .setTitle("🎵 Music Bot Commands")
      .setDescription("Control the bot with commands or use interactive buttons!")
      .addFields(
        { name: "`!play <url or search>`", value: "Play a YouTube video, playlist, or search term", inline: false },
        { name: "`!playnext <url or search>`", value: "Add song to play next in queue", inline: false },
        { name: "`!skip`", value: "Skip the current song", inline: true },
        { name: "`!stop`", value: "Stop playback and clear the queue", inline: true },
        { name: "`!queue`", value: "Show the current queue", inline: true },
        { name: "`!shuffle`", value: "Shuffle the queue", inline: true },
        { name: "`!loop [off/single/queue]`", value: "Toggle loop modes", inline: true },
        { name: "`!nowplaying` or `!np`", value: "Show current playing song with controls", inline: true },
        { name: "`!clear`", value: "Clear the queue (keeps current song)", inline: true },
        { name: "`!remove <number>`", value: "Remove song at position from queue", inline: true },
        { name: "`!lyrics [song]`", value: "Get lyrics info for current song or search term", inline: true },
        { name: "`!prev` or `!previous`", value: "Go back to the previous song", inline: true },
        { name: "\u200B", value: "**📋 Playlist Commands**", inline: false },
        { name: "`!playlist create <name>`", value: "Create a new playlist", inline: true },
        { name: "`!playlist add <name>`", value: "Add current song to playlist", inline: true },
        { name: "`!playlist list`", value: "List your playlists", inline: true },
        { name: "`!playlist show <name>`", value: "Show songs in a playlist", inline: true },
        { name: "`!playlist delete <name>`", value: "Delete a playlist", inline: true },
        { name: "`!playlist remove <name> <#>`", value: "Remove song from playlist", inline: true },
        { name: "`!play <playlist name>`", value: "Play a saved playlist", inline: true },
      )
      .setFooter({ text: "💡 Use the interactive buttons for easier control!" });
    
    return safeSend(message, { embeds: [embed] });
  }

  // ============ PLAYLIST COMMANDS ============
  if (command === "playlist" || command === "pl") {
    const subcommand = args[0]?.toLowerCase();
    const userId = message.author.id;

    if (subcommand === "create") {
      const playlistName = args.slice(1).join(" ");
      if (!playlistName) {
        return safeSend(message, "⚠️ Please provide a playlist name: `!playlist create <name>`");
      }

      const playlists = await getUserPlaylists(userId);
      
      if (playlists[playlistName]) {
        return safeSend(message, `⚠️ Playlist **${playlistName}** already exists.`);
      }

      playlists[playlistName] = [];
      const saved = await saveUserPlaylists(userId, playlists);
      
      if (saved) {
        return safeSend(message, `✅ Playlist **${playlistName}** created!`);
      } else {
        return safeSend(message, "❌ Failed to create playlist. Please try again.");
      }
    }

    if (subcommand === "add") {
      const playlistName = args.slice(1).join(" ");
      if (!playlistName) {
        return safeSend(message, "⚠️ Please provide a playlist name: `!playlist add <name>`");
      }

      const current = currentSongs.get(guildId);
      if (!current) {
        return safeSend(message, "⚠️ No song is currently playing.");
      }

      const playlists = await getUserPlaylists(userId);
      
      if (!playlists[playlistName]) {
        return safeSend(message, `❌ Playlist **${playlistName}** not found. Create it first with \`!playlist create ${playlistName}\``);
      }

      playlists[playlistName].push({
        title: current.title,
        url: current.url,
        duration: current.duration
      });

      const saved = await saveUserPlaylists(userId, playlists);
      
      if (saved) {
        return safeSend(message, `➕ Added **${current.title}** to **${playlistName}**`);
      } else {
        return safeSend(message, "❌ Failed to add song to playlist. Please try again.");
      }
    }

    if (subcommand === "list") {
      const playlists = await getUserPlaylists(userId);
      const playlistNames = Object.keys(playlists);

      if (playlistNames.length === 0) {
        return safeSend(message, "📭 You don't have any playlists yet. Create one with `!playlist create <name>`");
      }

      const playlistList = playlistNames
        .map(name => `• **${name}** - ${playlists[name].length} song(s)`)
        .join("\n");

      const embed = new EmbedBuilder()
        .setColor(0x9B59B6)
        .setTitle("🎶 Your Playlists")
        .setDescription(playlistList)
        .setFooter({ text: `Total: ${playlistNames.length} playlist(s)` });

      return safeSend(message, { embeds: [embed] });
    }

    if (subcommand === "show") {
      const playlistName = args.slice(1).join(" ");
      if (!playlistName) {
        return safeSend(message, "⚠️ Please provide a playlist name: `!playlist show <name>`");
      }

      const playlists = await getUserPlaylists(userId);
      
      if (!playlists[playlistName]) {
        return safeSend(message, `❌ Playlist **${playlistName}** not found.`);
      }

      const songs = playlists[playlistName];
      
      if (songs.length === 0) {
        return safeSend(message, `📭 Playlist **${playlistName}** is empty.`);
      }

      const songList = songs
        .slice(0, 10)
        .map((song, index) => `${index + 1}. ${song.title} (${song.duration || "Unknown"})`)
        .join("\n");

      const embed = new EmbedBuilder()
        .setColor(0x3498DB)
        .setTitle(`🎶 Playlist: ${playlistName}`)
        .setDescription(songList)
        .setFooter({ text: `Total: ${songs.length} song(s)${songs.length > 10 ? ` (showing first 10)` : ""}` });

      return safeSend(message, { embeds: [embed] });
    }

    if (subcommand === "delete") {
      const playlistName = args.slice(1).join(" ");
      if (!playlistName) {
        return safeSend(message, "⚠️ Please provide a playlist name: `!playlist delete <name>`");
      }

      const playlists = await getUserPlaylists(userId);
      
      if (!playlists[playlistName]) {
        return safeSend(message, `❌ Playlist **${playlistName}** not found.`);
      }

      delete playlists[playlistName];
      const saved = await saveUserPlaylists(userId, playlists);
      
      if (saved) {
        return safeSend(message, `🗑️ Playlist **${playlistName}** deleted.`);
      } else {
        return safeSend(message, "❌ Failed to delete playlist. Please try again.");
      }
    }

    if (subcommand === "remove") {
      const playlistName = args[1];
      const position = parseInt(args[2]);
      
      if (!playlistName || !position) {
        return safeSend(message, "⚠️ Usage: `!playlist remove <name> <song number>`");
      }

      const playlists = await getUserPlaylists(userId);
      
      if (!playlists[playlistName]) {
        return safeSend(message, `❌ Playlist **${playlistName}** not found.`);
      }

      if (position < 1 || position > playlists[playlistName].length) {
        return safeSend(message, `⚠️ Invalid position. Choose 1-${playlists[playlistName].length}`);
      }

      const removed = playlists[playlistName].splice(position - 1, 1)[0];
      const saved = await saveUserPlaylists(userId, playlists);
      
      if (saved) {
        return safeSend(message, `🗑️ Removed **${removed.title}** from **${playlistName}**`);
      } else {
        return safeSend(message, "❌ Failed to remove song. Please try again.");
      }
    }

    return safeSend(message, "⚠️ Unknown playlist command. Use `!help` to see available commands.");
  }
  // ============ END PLAYLIST COMMANDS ============

  if (command === "lyrics" || command === "ly") {
    let searchQuery = args.join(" ");
    
    if (!searchQuery) {
      const current = currentSongs.get(guildId);
      if (!current) {
        return safeSend(message, "⚠️ No song currently playing and no search term provided. Use `!lyrics <song name>` to search.");
      }
      searchQuery = current.title;
    }

    const loadingMsg = await safeSend(message, "🔍 Searching for lyrics...");
    
    try {
      const lyricsInfo = await searchLyrics(searchQuery);
      
      if (loadingMsg && loadingMsg.delete) {
        loadingMsg.delete().catch(() => {});
      }

      if (!lyricsInfo) {
        return safeSend(message, "❌ No lyrics found for this song.");
      }

      const embed = new EmbedBuilder()
        .setColor(0xFF1DB4)
        .setTitle("📝 Song Information")
        .setDescription(`**${lyricsInfo.title}**\nby ${lyricsInfo.artist}`)
        .addFields(
          { name: "Album", value: lyricsInfo.album || "Unknown", inline: true },
          { name: "Release Date", value: lyricsInfo.releaseDate || "Unknown", inline: true },
          { name: "View Full Lyrics", value: `[Click here to view on Genius](${lyricsInfo.url})`, inline: false }
        )
        .setThumbnail(lyricsInfo.thumbnail || null)
        .setFooter({ text: "Powered by Genius", iconURL: "https://images.genius.com/8ed669cadd956443e29c70361ec4f372.1000x1000x1.png" });

      return safeSend(message, { embeds: [embed] });
    } catch (error) {
      console.error("Lyrics search error:", error);
      if (loadingMsg && loadingMsg.delete) {
        loadingMsg.delete().catch(() => {});
      }
      return safeSend(message, "❌ Error searching for lyrics. Please try again.");
    }
  }

  if (command === "shuffle") {
    const queue = queues.get(guildId) || [];
    if (queue.length <= 1) return safeSend(message, "⚠️ Need at least 2 songs in queue to shuffle.");
    
    const rest = queue.slice(1);
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    queues.set(guildId, [queue[0], ...rest]);
    await updateNowPlayingMessage(guildId);
    return safeSend(message, "🔀 Queue shuffled!");
  }

  if (command === "loop") {
    const mode = args[0]?.toLowerCase();
    const currentMode = loopModes.get(guildId) || 0;
    let newMode = currentMode;
    let modeText = "";

    if (mode === "off" || mode === "none") {
      newMode = 0;
      modeText = "🔁 Loop disabled";
    } else if (mode === "single" || mode === "song") {
      newMode = 1;
      modeText = "🔂 Loop: Single song";
    } else if (mode === "queue" || mode === "all") {
      newMode = 2;
      modeText = "🔁 Loop: Entire queue";
    } else {
      newMode = (currentMode + 1) % 3;
      const modes = ["🔁 Loop disabled", "🔂 Loop: Single song", "🔁 Loop: Entire queue"];
      modeText = modes[newMode];
    }

    loopModes.set(guildId, newMode);
    await updateNowPlayingMessage(guildId);
    return safeSend(message, modeText);
  }

  if (command === "nowplaying" || command === "np") {
    const current = currentSongs.get(guildId);
    const queue = queues.get(guildId) || [];
    
    if (!current) {
      const embed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle("🎵 Music Player")
        .setDescription("No song currently playing");
      
      const msg = await safeSend(message, { 
        embeds: [embed],
        components: createMusicControls(guildId, true)
      });
      
      if (msg) {
        nowPlayingMessages.set(guildId, { message: msg, channel: message.channel });
      }
      return;
    }
    
    const loopMode = loopModes.get(guildId) || 0;
    const loopText = ["", "🔂", "🔁"][loopMode];
    
    const embed = new EmbedBuilder()
      .setColor(0x00FF00)
      .setTitle("🎵 Now Playing")
      .setDescription(`**${current.title}** ${loopText}`)
      .addFields(
        { name: "Duration", value: String(current.duration || "Unknown"), inline: true },
        { name: "Queue", value: `${queue.length} song(s)`, inline: true },
        { name: "Loop", value: ["Off", "Single", "Queue"][loopMode] || "Off", inline: true }
      )
      .setFooter({ text: "Use the buttons below to control playback" });
    
    const msg = await safeSend(message, { 
      embeds: [embed],
      components: createMusicControls(guildId, false)
    });
    
    if (msg) {
      nowPlayingMessages.set(guildId, { message: msg, channel: message.channel });
    }
    return;
  }

  if (command === "queue" || command === "q") {
    const queue = queues.get(guildId) || [];
    const current = currentSongs.get(guildId);
    
    if (!queue.length && !current) return safeSend(message, "📭 Queue is empty.");

    const loopMode = loopModes.get(guildId) || 0;
    const loopText = ["", " 🔂", " 🔁"][loopMode];

    let queueText = "";
    if (current) {
      queueText += `**Now Playing:**\n▶️ ${current.title}${loopText}\n\n`;
    }

    if (queue.length > 0) {
      queueText += "**Up Next:**\n";
      const displayQueue = queue.slice(0, 10);
      displayQueue.forEach((song, index) => {
        queueText += `${index + 1}. ${song.title}\n`;
      });
      
      if (queue.length > 10) {
        queueText += `\n... and ${queue.length - 10} more songs`;
      }
    }

    const embed = new EmbedBuilder()
      .setColor(0xFFFF00)
      .setTitle("📋 Music Queue")
      .setDescription(queueText)
      .setFooter({ text: `Total songs in queue: ${queue.length}` });

    return safeSend(message, { embeds: [embed] });
  }

  if (command === "clear") {
    const queue = queues.get(guildId) || [];
    if (!queue.length) return safeSend(message, "⚠️ Queue is already empty.");
    
    queues.set(guildId, []);
    await updateNowPlayingMessage(guildId);
    return safeSend(message, "🗑️ Queue cleared!");
  }

  if (command === "remove" || command === "rm") {
    const position = parseInt(args[0]);
    const queue = queues.get(guildId) || [];
    
    if (!position || position < 1 || position > queue.length) {
      return safeSend(message, `⚠️ Please provide a valid position (1-${queue.length})`);
    }
    
    const removed = queue.splice(position - 1, 1)[0];
    await updateNowPlayingMessage(guildId);
    return safeSend(message, `🗑️ Removed: **${removed.title}**`);
  }

  if (command === "play" || command === "playnext" || command === "pn") {
    const query = args.join(" ");
    if (!query) return safeSend(message, "⚠️ Provide a YouTube URL or search term.");
    const vc = message.member?.voice?.channel;
    if (!vc) return safeSend(message, "⚠️ Join a voice channel first.");
    musicChannels.set(guildId, message.channel);

    queues.set(guildId, queues.get(guildId) || []);
    const queue = queues.get(guildId);
    const isPlayNext = command === "playnext" || command === "pn";
    let added = false;

    // Check if query is a saved playlist
    const userId = message.author.id;
    const savedPlaylists = await getUserPlaylists(userId);
    
    if (savedPlaylists[query]) {
      const playlist = savedPlaylists[query];
      
      if (playlist.length === 0) {
        return safeSend(message, `📭 Playlist **${query}** is empty.`);
      }

      playlist.forEach(song => queue.push(song));

      const embed = new EmbedBuilder()
        .setColor(0x9B59B6)
        .setTitle("✅ Playlist Loaded")
        .setDescription(`Loaded **${playlist.length}** song(s) from **${query}**`)
        .setFooter({ text: `Queue position: ${queue.length - playlist.length + 1}-${queue.length}` });

      safeSend(message, { embeds: [embed] });

      // ✅ Use guild-specific player
      const guildPlayer = getOrCreatePlayer(guildId);
      if (guildPlayer.state.status !== AudioPlayerStatus.Playing) {
        playNext(vc, message);
      }
      return;
    }

    const loadingMsg = await safeSend(message, "🔍 Searching...");

    if (/list=/.test(query)) {
      if (isPlayNext) {
        if (loadingMsg && loadingMsg.delete) loadingMsg.delete().catch(() => {});
        return safeSend(message, "⚠️ Playlists are not supported for `!playnext`. Use `!play` instead.");
      }
      added = await addPlaylist(query, queue, message);
    } else if (/^https?:\/\//.test(query)) {
      added = await addSingle(query, queue, message, isPlayNext);
    } else {
      added = await addSearch(query, queue, message, isPlayNext);
    }

    if (loadingMsg && loadingMsg.delete) {
      loadingMsg.delete().catch(() => {});
    }

    // ✅ Use guild-specific player
    const guildPlayer = getOrCreatePlayer(guildId);
    if (added && guildPlayer.state.status !== AudioPlayerStatus.Playing) {
      playNext(vc, message);
    } else if (added) {
      if (isPlayNext && queue.length > 1) {
        safeSend(message, `⏭️ Added to play next: **${queue[1].title}**`);
      } else if (isPlayNext && queue.length === 1) {
        safeSend(message, `⏭️ Added to play next: **${queue[0].title}**`);
      } else {
        const position = queue.length;
        safeSend(message, `➕ Added to queue (position ${position}): **${queue[queue.length - 1].title}**`);
      }
      await updateNowPlayingMessage(guildId);
    }
  }

  if (command === "previous" || command === "prev") {
    const vc = message.member?.voice?.channel;
    if (!vc) return safeSend(message, "⚠️ Join a voice channel first.");

    const history = songHistory.get(guildId) || [];

    if (!history.length) {
      return safeSend(message, "⚠️ No previous songs in history.");
    }

    safeSend(message, "⏮️ Going to previous song...");
    await playPrevious(vc, message);
  }

  if (command === "skip") {
    const current = currentSongs.get(guildId);
    if (!current) return safeSend(message, "⚠️ Nothing is currently playing.");
    
    const player = players.get(guildId);
    if (player) player.stop();
    return safeSend(message, `⏭️ Skipped: **${current.title}**`);
  }

  if (command === "stop") {
    queues.set(guildId, []);
    currentSongs.delete(guildId);
    songHistory.delete(guildId);
    loopModes.set(guildId, 0);
    musicChannels.delete(guildId);
    const conn = connections.get(guildId);
    if (conn) {
      conn.destroy();
      connections.delete(guildId);
    }
    const stopStream = activeStreams.get(guildId);
    if (stopStream) { try { stopStream.kill('SIGKILL'); } catch (_) {} activeStreams.delete(guildId); }
    const player = players.get(guildId);
    if (player) {
      player.stop();
      players.delete(guildId);
    }
    await updateNowPlayingMessage(guildId);
    return safeSend(message, "⏹️ Stopped playback, cleared queue, and left voice channel.");
  }
});

async function searchLyrics(query) {
  try {
    if (!GENIUS_ACCESS_TOKEN) {
      console.error("Genius API key not found in environment variables");
      return null;
    }

    const cleanQuery = query
      .replace(/\([^)]*\)/g, '')
      .replace(/\[[^\]]*\]/g, '')
      .replace(/(official|music|video|audio|lyric|lyrics)/gi, '')
      .replace(/[-_]/g, ' ')
      .trim();

    const searchResponse = await axios.get(`${GENIUS_API_BASE}/search`, {
      headers: {
        'Authorization': `Bearer ${GENIUS_ACCESS_TOKEN}`
      },
      params: {
        q: cleanQuery
      }
    });

    if (!searchResponse.data.response.hits.length) {
      return null;
    }

    const hit = searchResponse.data.response.hits[0];
    const song = hit.result;

    const songResponse = await axios.get(`${GENIUS_API_BASE}/songs/${song.id}`, {
      headers: {
        'Authorization': `Bearer ${GENIUS_ACCESS_TOKEN}`
      }
    });

    const songDetails = songResponse.data.response.song;

    return {
      title: songDetails.title,
      artist: songDetails.primary_artist.name,
      album: songDetails.album ? songDetails.album.name : null,
      releaseDate: songDetails.release_date_for_display,
      url: songDetails.url,
      thumbnail: songDetails.song_art_image_thumbnail_url
    };
  } catch (error) {
    console.error("Genius API error:", error.response?.data || error.message);
    return null;
  }
}

function safeSend(message, content) {
  if (message.channel?.send) return message.channel.send(content).catch(() => {});
}

async function addPlaylist(url, queue, message) {
  try {
    const info = await ytdlp(url, YT_DLP_PLAYLIST_OPTIONS);
    
    if (!info.entries || info.entries.length === 0) {
      safeSend(message, "❌ No videos found in playlist.");
      return false;
    }
    
    const validEntries = info.entries.filter(v => v && v.title);
    
    validEntries.forEach((v) => {
      const fullUrl = v.url?.startsWith("http")
        ? v.url
        : `https://www.youtube.com/watch?v=${v.id}`;
      queue.push({ 
        title: v.title, 
        url: fullUrl, 
        duration: v.duration ? formatDuration(v.duration) : "Unknown"
      });
    });
    
    const embed = new EmbedBuilder()
      .setColor(0x00FF00)
      .setTitle("✅ Playlist Added")
      .setDescription(`Added **${validEntries.length}** songs from playlist **${info.title || 'Unknown Playlist'}**`)
      .setFooter({ text: `Queue position: ${queue.length - validEntries.length + 1}-${queue.length}` });
    
    safeSend(message, { embeds: [embed] });
    return true;
  } catch (error) {
    console.error("Playlist error:", error);
    safeSend(message, "❌ Failed to load playlist. Try updating yt-dlp: `npm install yt-dlp-exec@latest`");
    return false;
  }
}

async function addSingle(url, queue, message, insertAtFront = false) {
  try {
    const info = await ytdlp(url, { 
      dumpSingleJson: true, 
      format: "bestaudio/best",
      ...YT_DLP_BASE_OPTIONS
    });
    const song = { 
      title: info.title, 
      url,
      duration: info.duration ? formatDuration(info.duration) : "Unknown"
    };
    
    if (insertAtFront && queue.length > 0) {
      queue.splice(1, 0, song);
    } else {
      queue.push(song);
    }
    return true;
  } catch (error) {
    console.error("Single video error:", error);
    safeSend(message, "❌ Failed to get video info. Please check the URL.");
    return false;
  }
}

async function addSearch(query, queue, message, insertAtFront = false) {
  try {
    const info = await ytdlp(`ytsearch1:${query}`, { 
      dumpSingleJson: true,
      format: "bestaudio/best",
      ...YT_DLP_BASE_OPTIONS
    });
    if (!info.entries?.length) {
      safeSend(message, "❌ No results found for your search.");
      return false;
    }
    const v = info.entries[0];
    const song = {
      title: v.title,
      url: v.webpage_url || `https://www.youtube.com/watch?v=${v.id}`,
      duration: v.duration ? formatDuration(v.duration) : "Unknown"
    };
    
    if (insertAtFront && queue.length > 0) {
      queue.splice(1, 0, song);
    } else {
      queue.push(song);
    }
    return true;
  } catch (error) {
    console.error("Search error:", error);
    safeSend(message, "❌ Search failed. Please try again.");
    return false;
  }
}

async function playNext(voiceChannel, message) {
  const guildId = message.guild.id;
  const queue = queues.get(guildId);
  const loopMode = loopModes.get(guildId) || 0;
  
  if (!queue?.length) {
    currentSongs.delete(guildId);
    await updateNowPlayingMessage(guildId);
    return;
  }
  
  const song = queue[0];
  currentSongs.set(guildId, song);

  // ✅ Get the guild-specific player (creates it if needed)
  const player = getOrCreatePlayer(guildId);

  try {
    let connection = connections.get(guildId);
    
    if (!connection || connection.state.status === VoiceConnectionStatus.Destroyed) {
      connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: voiceChannel.guild.id,
        adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      });
      connections.set(guildId, connection);
    }
    
    await entersState(connection, VoiceConnectionStatus.Ready, 20_000);

    console.log(`🎵 [${guildId}] Attempting to play: ${song.title}`);

    // Kill any previous yt-dlp process to prevent broken pipe from old streams
    const prevStream = activeStreams.get(guildId);
    if (prevStream) {
      try { prevStream.kill('SIGKILL'); } catch (_) {}
      activeStreams.delete(guildId);
    }

    const ytStream = ytdlp.exec(song.url, {
      output: "-",
      format: "bestaudio/best",
      ...YT_DLP_BASE_OPTIONS,
      bufferSize: "16K",
      httpChunkSize: "10M",
    }, { 
      stdio: ["ignore", "pipe", "pipe"]
    });

    activeStreams.set(guildId, ytStream);

    ytStream.on('error', (error) => {
      if (error.code === 'EPIPE') return;
      console.error(`❌ [${guildId}] yt-dlp process error:`, error);
    });

    ytStream.stdout?.on('error', (error) => {
      if (error.code === 'EPIPE') return;
      console.error(`❌ [${guildId}] stdout error:`, error);
    });

    ytStream.stderr?.on('data', (data) => {
      const logLine = data.toString().trim();
      if (
        logLine.includes('Broken pipe') ||
        logLine.includes('unable to write data') ||
        logLine.includes('Sleeping') ||
        logLine.includes('Downloading')
      ) return;
      console.log(`yt-dlp [${guildId}]:`, logLine);
    });

    let receivedData = false;
    ytStream.stdout.on('data', (chunk) => {
      if (!receivedData) {
        receivedData = true;
        console.log(`✅ [${guildId}] Started receiving audio data (${chunk.length} bytes)`);
      }
    });

    const resource = createAudioResource(ytStream.stdout, {
      inputType: StreamType.Arbitrary,
      inlineVolume: true
    });

    if (resource.volume) {
      resource.volume.setVolume(0.5);
    }

    player.play(resource);
    connection.subscribe(player);
    
    const lyricsInfo = await searchLyrics(song.title).catch(() => null);
    
    const embed = new EmbedBuilder()
      .setColor(0x00FF00)
      .setTitle("🎵 Now Playing")
      .setDescription(`**${song.title}**`)
      .addFields(
        { name: "Duration", value: String(song.duration || "Unknown"), inline: true },
        { name: "Queue Position", value: `1 of ${queue.length}`, inline: true },
        { name: "Loop", value: ["Off", "Single", "Queue"][loopMode] || "Off", inline: true }
      )
      .setFooter({ text: "Use the buttons below or !np to control playback" });
    
    if (lyricsInfo) {
      embed.addFields({
        name: "📝 Lyrics",
        value: `[View on Genius](${lyricsInfo.url})`,
        inline: false
      });
    }
    
    const existingMsg = nowPlayingMessages.get(guildId);
    if (existingMsg) {
      try {
        await existingMsg.message.edit({
          embeds: [embed],
          components: createMusicControls(guildId, false)
        });
      } catch (err) {
        console.warn(`[${guildId}] Could not edit now-playing message, sending new one:`, err.message);
        const msg = await safeSend(message, {
          embeds: [embed],
          components: createMusicControls(guildId, false)
        });
        if (msg) {
          nowPlayingMessages.set(guildId, { message: msg, channel: message.channel });
        }
      }
    } else {
      const msg = await safeSend(message, {
        embeds: [embed],
        components: createMusicControls(guildId, false)
      });
      if (msg) {
        nowPlayingMessages.set(guildId, { message: msg, channel: message.channel });
      }
    }

    resource.playStream.on('error', (error) => {
      console.error(`❌ [${guildId}] PlayStream error:`, error);
    });

  } catch (error) {
    console.error(`❌ [${guildId}] Playback error:`, error);
    safeSend(message, `❌ Failed to play **${song.title}**, skipping...`);
    
    queue.shift();
    currentSongs.delete(guildId);
    await updateNowPlayingMessage(guildId);
    if (queue.length) {
      setTimeout(() => playNext(voiceChannel, message), 2000);
    }
  }
}

async function playPrevious(voiceChannel, message) {
  const guildId = message.guild.id;
  const queue = queues.get(guildId) || [];
  const history = songHistory.get(guildId) || [];
  const currentSong = currentSongs.get(guildId);

  if (!history.length) {
    return safeSend(message, "⚠️ No previous songs in history.");
  }

  if (currentSong && (queue.length === 0 || queue[0]?.url !== currentSong.url)) {
    queue.unshift(currentSong);
  }

  const prevSong = history.pop();
  queue.unshift(prevSong);
  songHistory.set(guildId, history);
  queues.set(guildId, queue);

  currentSongs.delete(guildId);

  // ✅ Per-guild skip flag and per-guild player stop
  skipNextIdle.add(guildId);
  const player = players.get(guildId);
  if (player) player.stop();

  setTimeout(() => playNext(voiceChannel, message), 500);
}

function formatDuration(seconds) {
  if (!seconds || isNaN(seconds)) return "Unknown";
  
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

process.on('SIGINT', () => {
  console.log('Shutting down bot...');
  connections.forEach(connection => connection.destroy());
  client.destroy();
  process.exit(0);
});

client.login(process.env.TOKEN);