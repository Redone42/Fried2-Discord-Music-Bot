const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  NoSubscriberBehavior,
  AudioPlayerStatus,
  entersState,
  VoiceConnectionStatus,
  StreamType,
} = require('@discordjs/voice');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const ytdlp = require('yt-dlp-exec');
const { searchLyrics } = require('./lyrics');
const { safeSend, sendReply, formatDuration } = require('./utils');

let client = null;

const players = new Map();
const queues = new Map();
const connections = new Map();
const loopModes = new Map();
const currentSongs = new Map();
const musicChannels = new Map();
const nowPlayingMessages = new Map();
const songHistory = new Map();
const activeStreams = new Map();
const skipNextIdle = new Set();

const YT_DLP_BASE_OPTIONS = {
  noWarnings: true,
  preferFreeFormats: true,
  noPlaylist: true,
  addHeader: [
    'User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  ],
  extractorArgs: 'youtube:player_client=android,web',
};

const YT_DLP_PLAYLIST_OPTIONS = {
  dumpSingleJson: true,
  flatPlaylist: true,
  noWarnings: true,
  ignoreErrors: true,
  addHeader: [
    'User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  ],
  extractorArgs: 'youtube:player_client=android,web',
};

function setClient(botClient) {
  client = botClient;
}

function createMusicControls(guildId, disabled = false) {
  const loopMode = loopModes.get(guildId) || 0;
  const loopEmojis = ['🔁', '🔂', '🔁'];
  const loopLabels = ['Loop: Off', 'Loop: Song', 'Loop: Queue'];

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('music_previous').setEmoji('⏮️').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    new ButtonBuilder().setCustomId('music_play_pause').setEmoji('⏸️').setStyle(ButtonStyle.Primary).setDisabled(disabled),
    new ButtonBuilder().setCustomId('music_skip').setEmoji('⏭️').setStyle(ButtonStyle.Primary).setDisabled(disabled),
    new ButtonBuilder().setCustomId('music_stop').setEmoji('⏹️').setStyle(ButtonStyle.Danger).setDisabled(disabled),
    new ButtonBuilder().setCustomId('music_shuffle').setEmoji('🔀').setStyle(ButtonStyle.Secondary).setDisabled(disabled)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('music_loop')
      .setEmoji(loopEmojis[loopMode])
      .setLabel(loopLabels[loopMode])
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
    new ButtonBuilder().setCustomId('music_queue').setEmoji('📋').setLabel('Queue').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    new ButtonBuilder().setCustomId('music_lyrics').setEmoji('📝').setLabel('Lyrics').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    new ButtonBuilder().setCustomId('music_clear').setEmoji('🗑️').setLabel('Clear Queue').setStyle(ButtonStyle.Secondary).setDisabled(disabled)
  );

  return [row1, row2];
}

function getOrCreatePlayer(guildId) {
  if (players.has(guildId)) return players.get(guildId);

  const player = createAudioPlayer({
    behaviors: { noSubscriber: NoSubscriberBehavior.Pause },
  });

  player.on(AudioPlayerStatus.Idle, async () => {
    if (skipNextIdle.has(guildId)) {
      skipNextIdle.delete(guildId);
      return;
    }

    const queue = queues.get(guildId) || [];
    const loopMode = loopModes.get(guildId) || 0;
    const currentSong = currentSongs.get(guildId);
    const musicChannel = musicChannels.get(guildId);

    if (!queue.length && !currentSong) return;

    const guild = client?.guilds.cache.get(guildId);
    if (!guild) return;

    const vc = guild.members.me?.voice.channel;
    if (!vc) return;

    if (currentSong && loopMode !== 1) {
      const history = songHistory.get(guildId) || [];
      history.push(currentSong);
      if (history.length > 50) history.shift();
      songHistory.set(guildId, history);
    }

    if (loopMode === 1 && currentSong) {
      return playNext(vc, { guild, channel: musicChannel || guild.systemChannel || guild.channels.cache.find((c) => c.isTextBased?.()) });
    }

    if (queue.length > 0) {
      const finishedSong = queue.shift();
      if (loopMode === 2 && finishedSong) {
        queue.push(finishedSong);
      }
    }

    currentSongs.delete(guildId);
    await updateNowPlayingMessage(guildId);

    if (queue.length > 0) {
      return playNext(vc, { guild, channel: musicChannel || guild.systemChannel || guild.channels.cache.find((c) => c.isTextBased?.()) });
    }

    const connection = connections.get(guildId);
    if (connection && loopMode === 0) {
      setTimeout(() => {
        if (connection.state.status !== VoiceConnectionStatus.Destroyed) {
          connection.destroy();
          connections.delete(guildId);
          musicChannels.delete(guildId);
          players.delete(guildId);
          updateNowPlayingMessage(guildId);
        }
      }, 5000);
    }
  });

  player.on('error', async (error) => {
    console.error(`❌ [${guildId}] AudioPlayer error:`, error.message);
    const queue = queues.get(guildId) || [];
    const musicChannel = musicChannels.get(guildId);
    const guild = client?.guilds.cache.get(guildId);
    if (!guild) return;

    if (queue.length > 0) {
      queue.shift();
      currentSongs.delete(guildId);
      await updateNowPlayingMessage(guildId);
      const vc = guild.members.me?.voice.channel;
      if (vc && queue.length > 0) {
        setTimeout(() => playNext(vc, { guild, channel: musicChannel || guild.systemChannel || guild.channels.cache.find((c) => c.isTextBased?.()) }), 2000);
      }
    }
  });

  player.on(AudioPlayerStatus.Playing, () => console.log(`▶️ [${guildId}] Player status: Playing`));
  player.on(AudioPlayerStatus.Paused, () => console.log(`⏸️ [${guildId}] Player status: Paused`));
  player.on(AudioPlayerStatus.Buffering, () => console.log(`⏳ [${guildId}] Player status: Buffering`));

  players.set(guildId, player);
  return player;
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
        embeds: [
          new EmbedBuilder().setColor(0xff0000).setTitle('🎵 Music Player').setDescription('No song currently playing'),
        ],
        components: createMusicControls(guildId, true),
      });
    } catch (err) {
      console.error('Failed to update now-playing message:', err.message);
    }
    return;
  }

  try {
    await msgData.message.edit({
      embeds: [
        new EmbedBuilder()
          .setColor(0x00ff00)
          .setTitle('🎵 Now Playing')
          .setDescription(`**${current.title}** ${['', '🔂', '🔁'][loopMode]}`)
          .addFields(
            { name: 'Duration', value: String(current.duration || 'Unknown'), inline: true },
            { name: 'Queue', value: `${queue.length} song(s)`, inline: true },
            { name: 'Loop', value: ['Off', 'Single', 'Queue'][loopMode] || 'Off', inline: true }
          )
          .setFooter({ text: 'Use the buttons below to control playback' }),
      ],
      components: createMusicControls(guildId, false),
    });
  } catch (err) {
    console.error('Failed to update now-playing message:', err.message);
  }
}

async function addPlaylist(url, queue, message) {
  try {
    const info = await ytdlp(url, YT_DLP_PLAYLIST_OPTIONS);
    if (!info.entries?.length) {
      await sendReply(message, '❌ No videos found in playlist.', { ephemeral: true });
      return false;
    }

    const validEntries = info.entries.filter((v) => v && v.title);
    validEntries.forEach((v) => {
      const fullUrl = v.url?.startsWith('http') ? v.url : `https://www.youtube.com/watch?v=${v.id}`;
      queue.push({ title: v.title, url: fullUrl, duration: v.duration ? formatDuration(v.duration) : 'Unknown' });
    });

    await sendReply(
      message,
      {
        embeds: [
          new EmbedBuilder()
            .setColor(0x00ff00)
            .setTitle('✅ Playlist Added')
            .setDescription(`Added **${validEntries.length}** songs from playlist **${info.title || 'Unknown Playlist'}**`)
            .setFooter({ text: `Queue position: ${queue.length - validEntries.length + 1}-${queue.length}` }),
        ],
      },
      { ephemeral: true }
    );
    return true;
  } catch (error) {
    console.error('Playlist error:', error);
    await sendReply(message, '❌ Failed to load playlist. Try updating yt-dlp: `npm install yt-dlp-exec@latest`', { ephemeral: true });
    return false;
  }
}

async function addSingle(url, queue, message, insertAtFront = false) {
  try {
    const info = await ytdlp(url, { dumpSingleJson: true, format: 'bestaudio/best', ...YT_DLP_BASE_OPTIONS });
    const song = { title: info.title, url, duration: info.duration ? formatDuration(info.duration) : 'Unknown' };
    if (insertAtFront && queue.length > 0) queue.splice(1, 0, song);
    else queue.push(song);
    return true;
  } catch (error) {
    console.error('Single video error:', error);
    await sendReply(message, '❌ Failed to get video info. Please check the URL.', { ephemeral: true });
    return false;
  }
}

async function addSearch(query, queue, message, insertAtFront = false) {
  try {
    const info = await ytdlp(`ytsearch1:${query}`, { dumpSingleJson: true, format: 'bestaudio/best', ...YT_DLP_BASE_OPTIONS });
    if (!info.entries?.length) {
      safeSend(message, '❌ No results found for your search.');
      return false;
    }
    const v = info.entries[0];
    const song = {
      title: v.title,
      url: v.webpage_url || `https://www.youtube.com/watch?v=${v.id}`,
      duration: v.duration ? formatDuration(v.duration) : 'Unknown',
    };
    if (insertAtFront && queue.length > 0) queue.splice(1, 0, song);
    else queue.push(song);
    return true;
  } catch (error) {
    console.error('Search error:', error);
    await sendReply(message, '❌ Search failed. Please try again.', { ephemeral: true });
    return false;
  }
}

async function playNext(voiceChannel, message) {
  const guildId = message.guild.id;
  const queue = queues.get(guildId);
  if (!queue?.length) {
    currentSongs.delete(guildId);
    await updateNowPlayingMessage(guildId);
    return;
  }

  const song = queue[0];
  currentSongs.set(guildId, song);
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
      connection.on('stateChange', (oldState, newState) => {
        if (newState.status === VoiceConnectionStatus.Disconnected || newState.status === VoiceConnectionStatus.Destroyed) {
          if (connections.get(guildId) === connection) connections.delete(guildId);
        }
      });
    }

    await entersState(connection, VoiceConnectionStatus.Ready, 20000);

    const previousStream = activeStreams.get(guildId);
    if (previousStream) {
      try {
        previousStream.kill('SIGKILL');
      } catch (_) {}
      activeStreams.delete(guildId);
    }

    const ytStream = ytdlp.exec(
      song.url,
      {
        output: '-',
        format: 'bestaudio/best',
        ...YT_DLP_BASE_OPTIONS,
        bufferSize: '16K',
        httpChunkSize: '10M',
      },
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );

    activeStreams.set(guildId, ytStream);
    ytStream.on('error', (error) => {
      if (error.code !== 'EPIPE') console.error(`❌ [${guildId}] yt-dlp process error:`, error);
    });
    ytStream.stdout?.on('error', (error) => {
      if (error.code !== 'EPIPE') console.error(`❌ [${guildId}] stdout error:`, error);
    });
    ytStream.stderr?.on('data', (data) => {
      const logLine = data.toString().trim();
      if (!['Broken pipe', 'unable to write data', 'Sleeping', 'Downloading'].some((substr) => logLine.includes(substr))) {
        console.log(`yt-dlp [${guildId}]:`, logLine);
      }
    });

    let receivedData = false;
    ytStream.stdout.on('data', (chunk) => {
      if (!receivedData) {
        receivedData = true;
        console.log(`✅ [${guildId}] Started receiving audio data (${chunk.length} bytes)`);
      }
    });

    const resource = createAudioResource(ytStream.stdout, { inputType: StreamType.Arbitrary, inlineVolume: true });
    if (resource.volume) resource.volume.setVolume(0.5);

    player.play(resource);
    connection.subscribe(player);

    const lyricsInfo = await searchLyrics(song.title).catch(() => null);
    const embed = new EmbedBuilder()
      .setColor(0x00ff00)
      .setTitle('🎵 Now Playing')
      .setDescription(`**${song.title}**`)
      .addFields(
        { name: 'Duration', value: String(song.duration || 'Unknown'), inline: true },
        { name: 'Queue Position', value: `1 of ${queue.length}`, inline: true },
        { name: 'Loop', value: ['Off', 'Single', 'Queue'][loopModes.get(guildId) || 0] || 'Off', inline: true }
      )
      .setFooter({ text: 'Use the buttons below or !np to control playback' });

    if (lyricsInfo) {
      embed.addFields({ name: '📝 Lyrics', value: `[View on Genius](${lyricsInfo.url})`, inline: false });
    }

    const existingMsg = nowPlayingMessages.get(guildId);
    if (existingMsg) {
      try {
        await existingMsg.message.edit({ embeds: [embed], components: createMusicControls(guildId, false) });
      } catch (err) {
        const msg = await safeSend(message, { embeds: [embed], components: createMusicControls(guildId, false) });
        if (msg) nowPlayingMessages.set(guildId, { message: msg, channel: message.channel });
      }
    } else {
      const msg = await safeSend(message, { embeds: [embed], components: createMusicControls(guildId, false) });
      if (msg) nowPlayingMessages.set(guildId, { message: msg, channel: message.channel });
    }

    resource.playStream.on('error', (error) => console.error(`❌ [${guildId}] PlayStream error:`, error));
  } catch (error) {
    console.error(`❌ [${guildId}] Playback error:`, error);
    safeSend(message, `❌ Failed to play **${song.title}**, skipping...`);
    queue.shift();
    currentSongs.delete(guildId);
    await updateNowPlayingMessage(guildId);
    if (queue.length) setTimeout(() => playNext(voiceChannel, message), 2000);
  }
}

async function playPrevious(voiceChannel, message) {
  const guildId = message.guild.id;
  const queue = queues.get(guildId) || [];
  const history = songHistory.get(guildId) || [];
  const currentSong = currentSongs.get(guildId);

  if (!history.length) {
    return safeSend(message, '⚠️ No previous songs in history.');
  }

  if (currentSong && (queue.length === 0 || queue[0]?.url !== currentSong.url)) {
    queue.unshift(currentSong);
  }

  const prevSong = history.pop();
  queue.unshift(prevSong);
  songHistory.set(guildId, history);
  queues.set(guildId, queue);
  currentSongs.delete(guildId);
  skipNextIdle.add(guildId);

  const player = players.get(guildId);
  if (player) player.stop();
  setTimeout(() => playNext(voiceChannel, message), 500);
}

module.exports = {
  setClient,
  getOrCreatePlayer,
  createMusicControls,
  updateNowPlayingMessage,
  addPlaylist,
  addSingle,
  addSearch,
  playNext,
  playPrevious,
  queues,
  currentSongs,
  loopModes,
  nowPlayingMessages,
  songHistory,
  activeStreams,
  connections,
  musicChannels,
  players,
};