const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { AudioPlayerStatus } = require('@discordjs/voice');
const { getUserPlaylists, saveUserPlaylists } = require('./playlistStore');
const { searchLyrics } = require('./lyrics');
const { safeSend } = require('./utils');
const {
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
  songHistory,
  activeStreams,
  musicChannels,
  connections,
  players,
} = require('./musicPlayer');

const prefix = '!';

const slashCommands = [
  new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play a YouTube song, playlist, or saved playlist')
    .addStringOption((option) => option.setName('query').setDescription('URL, search term, or playlist name').setRequired(true)),
  new SlashCommandBuilder()
    .setName('playnext')
    .setDescription('Add a song to play next')
    .addStringOption((option) => option.setName('query').setDescription('URL or search term').setRequired(true)),
  new SlashCommandBuilder().setName('skip').setDescription('Skip the current song'),
  new SlashCommandBuilder().setName('stop').setDescription('Stop playback and clear the queue'),
  new SlashCommandBuilder().setName('queue').setDescription('Show the current queue'),
  new SlashCommandBuilder().setName('shuffle').setDescription('Shuffle the queue'),
  new SlashCommandBuilder()
    .setName('loop')
    .setDescription('Change loop mode')
    .addStringOption((option) =>
      option
        .setName('mode')
        .setDescription('Loop mode')
        .addChoices(
          { name: 'Off', value: 'off' },
          { name: 'Single', value: 'single' },
          { name: 'Queue', value: 'queue' }
        )
    ),
  new SlashCommandBuilder().setName('nowplaying').setDescription('Show the currently playing song'),
  new SlashCommandBuilder().setName('clear').setDescription('Clear the queue'),
  new SlashCommandBuilder().setName('remove').setDescription('Remove a song from the queue').addIntegerOption((option) => option.setName('position').setDescription('Song position in queue').setRequired(true)),
  new SlashCommandBuilder().setName('lyrics').setDescription('Search for lyrics').addStringOption((option) => option.setName('query').setDescription('Song title to search').setRequired(false)),
  new SlashCommandBuilder().setName('previous').setDescription('Play the previous song'),
  new SlashCommandBuilder().setName('help').setDescription('Show bot help'),
  new SlashCommandBuilder()
    .setName('playlist')
    .setDescription('Manage your saved playlists')
    .addSubcommand((subcommand) => subcommand.setName('create').setDescription('Create a playlist').addStringOption((option) => option.setName('name').setDescription('Playlist name').setRequired(true)))
    .addSubcommand((subcommand) => subcommand.setName('add').setDescription('Add current song to a playlist').addStringOption((option) => option.setName('name').setDescription('Playlist name').setRequired(true)))
    .addSubcommand((subcommand) => subcommand.setName('list').setDescription('List your playlists'))
    .addSubcommand((subcommand) => subcommand.setName('show').setDescription('Show songs in a playlist').addStringOption((option) => option.setName('name').setDescription('Playlist name').setRequired(true)))
    .addSubcommand((subcommand) => subcommand.setName('delete').setDescription('Delete a playlist').addStringOption((option) => option.setName('name').setDescription('Playlist name').setRequired(true)))
    .addSubcommand((subcommand) =>
      subcommand
        .setName('remove')
        .setDescription('Remove a song from a playlist')
        .addStringOption((option) => option.setName('name').setDescription('Playlist name').setRequired(true))
        .addIntegerOption((option) => option.setName('position').setDescription('Song number').setRequired(true))
    ),
].map((command) => command.toJSON());

async function handleInteraction(interaction) {
  if (interaction.isChatInputCommand()) return handleChatCommand(interaction);
  if (interaction.isButton()) return handleButton(interaction);
}

async function handleChatCommand(interaction) {
  const guildId = interaction.guild.id;
  const command = interaction.commandName;
  const queue = queues.get(guildId) || [];
  const current = currentSongs.get(guildId);
  const player = players.get(guildId);

  if (command === 'help') {
    const embed = new EmbedBuilder()
      .setColor(0x0099ff)
      .setTitle('🎵 Music Bot Commands')
      .setDescription('Control the bot with commands or use interactive buttons!')
      .addFields(
        { name: '`/play <query>`', value: 'Play a YouTube song, playlist, or saved playlist', inline: false },
        { name: '`/playnext <query>`', value: 'Add song to play next in queue', inline: false },
        { name: '`/skip`', value: 'Skip the current song', inline: true },
        { name: '`/stop`', value: 'Stop playback and clear the queue', inline: true },
        { name: '`/queue`', value: 'Show the current queue', inline: true },
        { name: '`/shuffle`', value: 'Shuffle the queue', inline: true },
        { name: '`/loop [mode]`', value: 'Toggle loop modes', inline: true },
        { name: '`/nowplaying`', value: 'Show current playing song with controls', inline: true },
        { name: '`/clear`', value: 'Clear the queue', inline: true },
        { name: '`/remove <position>`', value: 'Remove song at position from queue', inline: true },
        { name: '`/lyrics [query]`', value: 'Get lyrics info for current song or search term', inline: true },
        { name: '`/previous`', value: 'Go back to the previous song', inline: true },
        { name: '\u200B', value: '**📋 Playlist Commands**', inline: false },
        { name: '`/playlist create <name>`', value: 'Create a new playlist', inline: true },
        { name: '`/playlist add <name>`', value: 'Add current song to playlist', inline: true },
        { name: '`/playlist list`', value: 'List your playlists', inline: true },
        { name: '`/playlist show <name>`', value: 'Show songs in a playlist', inline: true },
        { name: '`/playlist delete <name>`', value: 'Delete a playlist', inline: true },
        { name: '`/playlist remove <name> <#>`', value: 'Remove song from playlist', inline: true }
      )
      .setFooter({ text: '💡 Use the interactive buttons for easier control!' });
    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  if (command === 'play' || command === 'playnext') {
    const query = interaction.options.getString('query', true);
    const vc = interaction.member?.voice?.channel;
    if (!vc) return interaction.reply({ content: '⚠️ Join a voice channel first.', ephemeral: true });
    musicChannels.set(guildId, interaction.channel);
    queues.set(guildId, queues.get(guildId) || []);
    const queue = queues.get(guildId);
    const isPlayNext = command === 'playnext';
    let added = false;

    await interaction.reply({ content: '🔍 Searching...', ephemeral: true });

    const userId = interaction.user.id;
    const savedPlaylists = await getUserPlaylists(userId);
    if (savedPlaylists[query]) {
      const playlist = savedPlaylists[query];
      if (!playlist.length) return interaction.followUp({ content: `📭 Playlist **${query}** is empty.`, ephemeral: true });
      playlist.forEach((song) => queue.push(song));
      const embed = new EmbedBuilder()
        .setColor(0x9b59b6)
        .setTitle('✅ Playlist Loaded')
        .setDescription(`Loaded **${playlist.length}** song(s) from **${query}**`)
        .setFooter({ text: `Queue position: ${queue.length - playlist.length + 1}-${queue.length}` });
      await interaction.followUp({ embeds: [embed], ephemeral: true });
      const guildPlayer = getOrCreatePlayer(guildId);
      if (guildPlayer.state.status !== AudioPlayerStatus.Playing) {
        return playNext(vc, interaction);
      }
      return;
    }

    if (/list=/.test(query)) {
      if (isPlayNext) return interaction.followUp({ content: '⚠️ Playlists are not supported for `/playnext`. Use `/play` instead.', ephemeral: true });
      added = await addPlaylist(query, queue, interaction);
    } else if (/^https?:\/\//.test(query)) {
      added = await addSingle(query, queue, interaction, isPlayNext);
    } else {
      added = await addSearch(query, queue, interaction, isPlayNext);
    }

    const guildPlayer = getOrCreatePlayer(guildId);
    if (added && guildPlayer.state.status !== AudioPlayerStatus.Playing) {
      return playNext(vc, interaction);
    }
    if (added) {
      if (isPlayNext && queue.length > 1) {
        return interaction.followUp({ content: `⏭️ Added to play next: **${queue[1].title}**`, ephemeral: true });
      }
      return interaction.followUp({ content: `➕ Added to queue (position ${queue.length}): **${queue[queue.length - 1].title}**`, ephemeral: true });
    }
    return;
  }

  if (command === 'skip') {
    if (!current) return interaction.reply({ content: '⚠️ Nothing is currently playing.', ephemeral: true });
    if (player) player.stop();
    return interaction.reply({ content: `⏭️ Skipped: **${current.title}**`, ephemeral: true });
  }

  if (command === 'stop') {
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
    if (stopStream) {
      try { stopStream.kill('SIGKILL'); } catch (_) {}
      activeStreams.delete(guildId);
    }
    if (player) {
      player.stop();
      players.delete(guildId);
    }
    await updateNowPlayingMessage(guildId);
    return interaction.reply({ content: '⏹️ Stopped playback, cleared queue, and left voice channel.', ephemeral: true });
  }

  if (command === 'queue') {
    if (!queue.length && !current) return interaction.reply({ content: '📭 Queue is empty.', ephemeral: true });
    const loopMode = loopModes.get(guildId) || 0;
    const loopText = ['', ' 🔂', ' 🔁'][loopMode];
    let queueText = '';
    if (current) queueText += `**Now Playing:**\n▶️ ${current.title}${loopText}\n\n`;
    if (queue.length > 0) {
      queueText += '**Up Next:**\n';
      queue.slice(0, 10).forEach((song, index) => {
        queueText += `${index + 1}. ${song.title}\n`;
      });
      if (queue.length > 10) queueText += `\n... and ${queue.length - 10} more songs`;
    }
    const embed = new EmbedBuilder().setColor(0xffff00).setTitle('📋 Music Queue').setDescription(queueText).setFooter({ text: `Total songs in queue: ${queue.length}` });
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (command === 'shuffle') {
    if (queue.length <= 1) return interaction.reply({ content: '⚠️ Need at least 2 songs in queue to shuffle.', ephemeral: true });
    const rest = queue.slice(1);
    for (let i = rest.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    queues.set(guildId, [queue[0], ...rest]);
    await updateNowPlayingMessage(guildId);
    return interaction.reply({ content: '🔀 Queue shuffled!', ephemeral: true });
  }

  if (command === 'loop') {
    const mode = interaction.options.getString('mode');
    const currentMode = loopModes.get(guildId) || 0;
    let newMode = currentMode;
    let modeText = '';

    if (mode === 'off' || mode === 'none') {
      newMode = 0;
      modeText = '🔁 Loop disabled';
    } else if (mode === 'single' || mode === 'song') {
      newMode = 1;
      modeText = '🔂 Loop: Single song';
    } else if (mode === 'queue' || mode === 'all') {
      newMode = 2;
      modeText = '🔁 Loop: Entire queue';
    } else {
      newMode = (currentMode + 1) % 3;
      modeText = ['🔁 Loop disabled', '🔂 Loop: Single song', '🔁 Loop: Entire queue'][newMode];
    }

    loopModes.set(guildId, newMode);
    await updateNowPlayingMessage(guildId);
    return interaction.reply({ content: modeText, ephemeral: true });
  }

  if (command === 'nowplaying') {
    if (!current) {
      const embed = new EmbedBuilder().setColor(0xff0000).setTitle('🎵 Music Player').setDescription('No song currently playing');
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
    const loopMode = loopModes.get(guildId) || 0;
    const embed = new EmbedBuilder()
      .setColor(0x00ff00)
      .setTitle('🎵 Now Playing')
      .setDescription(`**${current.title}** ${['', '🔂', '🔁'][loopMode]}`)
      .addFields(
        { name: 'Duration', value: String(current.duration || 'Unknown'), inline: true },
        { name: 'Queue', value: `${queue.length} song(s)`, inline: true },
        { name: 'Loop', value: ['Off', 'Single', 'Queue'][loopMode] || 'Off', inline: true }
      )
      .setFooter({ text: 'Use the buttons below to control playback' });
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (command === 'clear') {
    if (!queue.length) return interaction.reply({ content: '⚠️ Queue is already empty.', ephemeral: true });
    queues.set(guildId, []);
    await updateNowPlayingMessage(guildId);
    return interaction.reply({ content: '🗑️ Queue cleared!', ephemeral: true });
  }

  if (command === 'remove') {
    const position = interaction.options.getInteger('position');
    if (!position || position < 1 || position > queue.length) return interaction.reply({ content: `⚠️ Please provide a valid position (1-${queue.length})`, ephemeral: true });
    const removed = queue.splice(position - 1, 1)[0];
    await updateNowPlayingMessage(guildId);
    return interaction.reply({ content: `🗑️ Removed: **${removed.title}**`, ephemeral: true });
  }

  if (command === 'lyrics') {
    const query = interaction.options.getString('query');
    let searchQuery = query;
    if (!searchQuery) {
      if (!current) return interaction.reply({ content: '⚠️ No song currently playing and no search term provided. Use `/lyrics <song name>` to search.', ephemeral: true });
      searchQuery = current.title;
    }

    await interaction.reply({ content: '🔍 Searching for lyrics...', ephemeral: true });
    try {
      const lyricsInfo = await searchLyrics(searchQuery);
      if (!lyricsInfo) return interaction.editReply({ content: '❌ No lyrics found for this song' });
      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xff1db4)
            .setTitle('📝 Song Information')
            .setDescription(`**${lyricsInfo.title}**\nby ${lyricsInfo.artist}`)
            .addFields(
              { name: 'Album', value: lyricsInfo.album || 'Unknown', inline: true },
              { name: 'Release Date', value: lyricsInfo.releaseDate || 'Unknown', inline: true },
              { name: 'View Full Lyrics', value: `[Click here to view on Genius](${lyricsInfo.url})`, inline: false }
            )
            .setThumbnail(lyricsInfo.thumbnail || null)
            .setFooter({ text: 'Powered by Genius', iconURL: 'https://images.genius.com/8ed669cadd956443e29c70361ec4f372.1000x1000x1.png' }),
        ],
      });
    } catch (error) {
      console.error('Lyrics search error:', error);
      return interaction.editReply({ content: '❌ Error searching for lyrics. Please try again.' });
    }
  }

  if (command === 'previous') {
    const vc = interaction.member?.voice?.channel;
    if (!vc) return interaction.reply({ content: '⚠️ Join a voice channel first.', ephemeral: true });
    const history = songHistory.get(guildId) || [];
    if (!history.length) return interaction.reply({ content: '⚠️ No previous songs in history.', ephemeral: true });
    await interaction.reply({ content: '⏮️ Going to previous song...', ephemeral: true });
    await playPrevious(vc, interaction);
    return;
  }

  return interaction.reply({ content: '⚠️ Unknown command.', ephemeral: true });
}

async function handleButton(interaction) {

  const guildId = interaction.guild.id;
  const queue = queues.get(guildId) || [];
  const current = currentSongs.get(guildId);
  const player = players.get(guildId);

  switch (interaction.customId) {
    case 'music_play_pause': {
      if (!player) {
        await interaction.reply({ content: '⚠️ Nothing is playing', ephemeral: true });
        return;
      }

      if (player.state.status === AudioPlayerStatus.Playing) {
        player.pause();
        await interaction.reply({ content: '⏸️ Paused playback', ephemeral: true });
      } else if (player.state.status === AudioPlayerStatus.Paused) {
        player.unpause();
        await interaction.reply({ content: '▶️ Resumed playback', ephemeral: true });
      } else {
        await interaction.reply({ content: '⚠️ Nothing is playing', ephemeral: true });
      }
      break;
    }

    case 'music_skip': {
      if (!current || !player) {
        await interaction.reply({ content: '⚠️ Nothing is currently playing', ephemeral: true });
        return;
      }
      player.stop();
      await interaction.reply({ content: `⏭️ Skipped: **${current.title}**`, ephemeral: true });
      break;
    }

    case 'music_previous': {
      const vc = interaction.member?.voice?.channel;
      if (!vc) {
        await interaction.reply({ content: '⚠️ Join a voice channel first', ephemeral: true });
        return;
      }
      const history = songHistory.get(guildId) || [];
      if (!history.length) {
        await interaction.reply({ content: '⚠️ No previous songs in history.', ephemeral: true });
        return;
      }
      await interaction.reply({ content: '⏮️ Going to previous song...', ephemeral: true });
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
      if (stopStream) {
        try {
          stopStream.kill('SIGKILL');
        } catch (_) {}
        activeStreams.delete(guildId);
      }
      if (player) {
        player.stop();
        players.delete(guildId);
      }
      await interaction.reply({ content: '⏹️ Stopped playback and cleared queue', ephemeral: true });
      await updateNowPlayingMessage(guildId);
      break;
    }

    case 'music_shuffle': {
      if (queue.length <= 1) {
        await interaction.reply({ content: '⚠️ Need at least 2 songs in queue to shuffle', ephemeral: true });
        return;
      }
      const rest = queue.slice(1);
      for (let i = rest.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [rest[i], rest[j]] = [rest[j], rest[i]];
      }
      queues.set(guildId, [queue[0], ...rest]);
      await interaction.reply({ content: '🔀 Queue shuffled!', ephemeral: true });
      break;
    }

    case 'music_loop': {
      const currentMode = loopModes.get(guildId) || 0;
      const newMode = (currentMode + 1) % 3;
      loopModes.set(guildId, newMode);
      const modes = ['🔁 Loop disabled', '🔂 Loop: Single song', '🔁 Loop: Entire queue'];
      await interaction.reply({ content: modes[newMode], ephemeral: true });
      await updateNowPlayingMessage(guildId);
      break;
    }

    case 'music_queue': {
      if (!queue.length && !current) {
        await interaction.reply({ content: '📭 Queue is empty', ephemeral: true });
        return;
      }

      let queueText = '';
      if (current) {
        const loopText = ['', ' 🔂', ' 🔁'][loopModes.get(guildId) || 0];
        queueText += `**Now Playing:**\n▶️ ${current.title}${loopText}\n\n`;
      }
      if (queue.length > 0) {
        queueText += '**Up Next:**\n';
        queue.slice(0, 10).forEach((song, index) => {
          queueText += `${index + 1}. ${song.title}\n`;
        });
        if (queue.length > 10) queueText += `\n... and ${queue.length - 10} more songs`;
      }

      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xffff00)
            .setTitle('📋 Music Queue')
            .setDescription(queueText)
            .setFooter({ text: `Total songs in queue: ${queue.length}` }),
        ],
        ephemeral: true,
      });
      break;
    }

    case 'music_lyrics': {
      if (!current) {
        await interaction.reply({ content: '⚠️ No song currently playing', ephemeral: true });
        return;
      }

      await interaction.deferReply({ ephemeral: true });
      try {
        const lyricsInfo = await searchLyrics(current.title);
        if (!lyricsInfo) {
          await interaction.editReply({ content: '❌ No lyrics found for this song' });
          return;
        }

        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xff1db4)
              .setTitle('📝 Song Information')
              .setDescription(`**${lyricsInfo.title}**\nby ${lyricsInfo.artist}`)
              .addFields(
                { name: 'Album', value: lyricsInfo.album || 'Unknown', inline: true },
                { name: 'Release Date', value: lyricsInfo.releaseDate || 'Unknown', inline: true },
                { name: 'View Full Lyrics', value: `[Click here to view on Genius](${lyricsInfo.url})`, inline: false }
              )
              .setThumbnail(lyricsInfo.thumbnail || null)
              .setFooter({ text: 'Powered by Genius', iconURL: 'https://images.genius.com/8ed669cadd956443e29c70361ec4f372.1000x1000x1.png' }),
          ],
        });
      } catch (error) {
        console.error('Lyrics button error:', error);
        await interaction.editReply({ content: '❌ Error searching for lyrics' });
      }
      break;
    }

    case 'music_clear': {
      if (!queue.length) {
        await interaction.reply({ content: '⚠️ Queue is already empty', ephemeral: true });
        return;
      }
      queues.set(guildId, []);
      await interaction.reply({ content: '🗑️ Queue cleared!', ephemeral: true });
      break;
    }

    default:
      break;
  }
}

async function handleMessage(message) {
  if (message.author.bot || !message.content.startsWith(prefix) || !message.guild) return;

  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const command = args.shift()?.toLowerCase();
  const guildId = message.guild.id;

  if (command === 'help') {
    const embed = new EmbedBuilder()
      .setColor(0x0099ff)
      .setTitle('🎵 Music Bot Commands')
      .setDescription('Control the bot with commands or use interactive buttons!')
      .addFields(
        { name: '`!play <url or search>`', value: 'Play a YouTube video, playlist, or search term', inline: false },
        { name: '`!playnext <url or search>`', value: 'Add song to play next in queue', inline: false },
        { name: '`!skip`', value: 'Skip the current song', inline: true },
        { name: '`!stop`', value: 'Stop playback and clear the queue', inline: true },
        { name: '`!queue`', value: 'Show the current queue', inline: true },
        { name: '`!shuffle`', value: 'Shuffle the queue', inline: true },
        { name: '`!loop [off/single/queue]`', value: 'Toggle loop modes', inline: true },
        { name: '`!nowplaying` or `!np`', value: 'Show current playing song with controls', inline: true },
        { name: '`!clear`', value: 'Clear the queue (keeps current song)', inline: true },
        { name: '`!remove <number>`', value: 'Remove song at position from queue', inline: true },
        { name: '`!lyrics [song]`', value: 'Get lyrics info for current song or search term', inline: true },
        { name: '`!prev` or `!previous`', value: 'Go back to the previous song', inline: true },
        { name: '\u200B', value: '**📋 Playlist Commands**', inline: false },
        { name: '`!playlist create <name>`', value: 'Create a new playlist', inline: true },
        { name: '`!playlist add <name>`', value: 'Add current song to playlist', inline: true },
        { name: '`!playlist list`', value: 'List your playlists', inline: true },
        { name: '`!playlist show <name>`', value: 'Show songs in a playlist', inline: true },
        { name: '`!playlist delete <name>`', value: 'Delete a playlist', inline: true },
        { name: '`!playlist remove <name> <#>`', value: 'Remove song from playlist', inline: true },
        { name: '`!play <playlist name>`', value: 'Play a saved playlist', inline: true }
      )
      .setFooter({ text: '💡 Use the interactive buttons for easier control!' });

    return safeSend(message, { embeds: [embed] });
  }

  if (command === 'playlist' || command === 'pl') {
    const subcommand = args[0]?.toLowerCase();
    const userId = message.author.id;

    if (subcommand === 'create') {
      const playlistName = args.slice(1).join(' ');
      if (!playlistName) return safeSend(message, '⚠️ Please provide a playlist name: `!playlist create <name>`');
      const playlists = await getUserPlaylists(userId);
      if (playlists[playlistName]) return safeSend(message, `⚠️ Playlist **${playlistName}** already exists.`);
      playlists[playlistName] = [];
      const saved = await saveUserPlaylists(userId, playlists);
      return safeSend(message, saved ? `✅ Playlist **${playlistName}** created!` : '❌ Failed to create playlist. Please try again.');
    }

    if (subcommand === 'add') {
      const playlistName = args.slice(1).join(' ');
      if (!playlistName) return safeSend(message, '⚠️ Please provide a playlist name: `!playlist add <name>`');
      const current = currentSongs.get(guildId);
      if (!current) return safeSend(message, '⚠️ No song is currently playing.');
      const playlists = await getUserPlaylists(userId);
      if (!playlists[playlistName]) return safeSend(message, `❌ Playlist **${playlistName}** not found. Create it first with \`!playlist create ${playlistName}\``);
      playlists[playlistName].push({ title: current.title, url: current.url, duration: current.duration });
      const saved = await saveUserPlaylists(userId, playlists);
      return safeSend(message, saved ? `➕ Added **${current.title}** to **${playlistName}**` : '❌ Failed to add song to playlist. Please try again.');
    }

    if (subcommand === 'list') {
      const playlists = await getUserPlaylists(userId);
      const playlistNames = Object.keys(playlists);
      if (!playlistNames.length) return safeSend(message, "📭 You don't have any playlists yet. Create one with `!playlist create <name>`");
      const playlistList = playlistNames.map((name) => `• **${name}** - ${playlists[name].length} song(s)`).join('\n');
      return safeSend(message, {
        embeds: [
          new EmbedBuilder().setColor(0x9b59b6).setTitle('🎶 Your Playlists').setDescription(playlistList).setFooter({ text: `Total: ${playlistNames.length} playlist(s)` }),
        ],
      });
    }

    if (subcommand === 'show') {
      const playlistName = args.slice(1).join(' ');
      if (!playlistName) return safeSend(message, '⚠️ Please provide a playlist name: `!playlist show <name>`');
      const playlists = await getUserPlaylists(userId);
      if (!playlists[playlistName]) return safeSend(message, `❌ Playlist **${playlistName}** not found.`);
      const songs = playlists[playlistName];
      if (!songs.length) return safeSend(message, `📭 Playlist **${playlistName}** is empty.`);
      const songList = songs.slice(0, 10).map((song, index) => `${index + 1}. ${song.title} (${song.duration || 'Unknown'})`).join('\n');
      return safeSend(message, {
        embeds: [
          new EmbedBuilder().setColor(0x3498db).setTitle(`🎶 Playlist: ${playlistName}`).setDescription(songList).setFooter({ text: `Total: ${songs.length} song(s)${songs.length > 10 ? ' (showing first 10)' : ''}` }),
        ],
      });
    }

    if (subcommand === 'delete') {
      const playlistName = args.slice(1).join(' ');
      if (!playlistName) return safeSend(message, '⚠️ Please provide a playlist name: `!playlist delete <name>`');
      const playlists = await getUserPlaylists(userId);
      if (!playlists[playlistName]) return safeSend(message, `❌ Playlist **${playlistName}** not found.`);
      delete playlists[playlistName];
      const saved = await saveUserPlaylists(userId, playlists);
      return safeSend(message, saved ? `🗑️ Playlist **${playlistName}** deleted.` : '❌ Failed to delete playlist. Please try again.');
    }

    if (subcommand === 'remove') {
      const playlistName = args[1];
      const position = parseInt(args[2], 10);
      if (!playlistName || !position) return safeSend(message, '⚠️ Usage: `!playlist remove <name> <song number>`');
      const playlists = await getUserPlaylists(userId);
      if (!playlists[playlistName]) return safeSend(message, `❌ Playlist **${playlistName}** not found.`);
      if (position < 1 || position > playlists[playlistName].length) return safeSend(message, `⚠️ Invalid position. Choose 1-${playlists[playlistName].length}`);
      const removed = playlists[playlistName].splice(position - 1, 1)[0];
      const saved = await saveUserPlaylists(userId, playlists);
      return safeSend(message, saved ? `🗑️ Removed **${removed.title}** from **${playlistName}**` : '❌ Failed to remove song. Please try again.');
    }

    return safeSend(message, '⚠️ Unknown playlist command. Use `!help` to see available commands.');
  }

  if (command === 'lyrics' || command === 'ly') {
    let searchQuery = args.join(' ');
    if (!searchQuery) {
      const current = currentSongs.get(guildId);
      if (!current) return safeSend(message, '⚠️ No song currently playing and no search term provided. Use `!lyrics <song name>` to search.');
      searchQuery = current.title;
    }

    const loadingMsg = await safeSend(message, '🔍 Searching for lyrics...');
    try {
      const lyricsInfo = await searchLyrics(searchQuery);
      if (loadingMsg?.delete) loadingMsg.delete().catch(() => {});
      if (!lyricsInfo) return safeSend(message, '❌ No lyrics found for this song.');
      return safeSend(message, {
        embeds: [
          new EmbedBuilder()
            .setColor(0xff1db4)
            .setTitle('📝 Song Information')
            .setDescription(`**${lyricsInfo.title}**\nby ${lyricsInfo.artist}`)
            .addFields(
              { name: 'Album', value: lyricsInfo.album || 'Unknown', inline: true },
              { name: 'Release Date', value: lyricsInfo.releaseDate || 'Unknown', inline: true },
              { name: 'View Full Lyrics', value: `[Click here to view on Genius](${lyricsInfo.url})`, inline: false }
            )
            .setThumbnail(lyricsInfo.thumbnail || null)
            .setFooter({ text: 'Powered by Genius', iconURL: 'https://images.genius.com/8ed669cadd956443e29c70361ec4f372.1000x1000x1.png' }),
        ],
      });
    } catch (error) {
      console.error('Lyrics search error:', error);
      if (loadingMsg?.delete) loadingMsg.delete().catch(() => {});
      return safeSend(message, '❌ Error searching for lyrics. Please try again.');
    }
  }

  if (command === 'shuffle') {
    const queue = queues.get(guildId) || [];
    if (queue.length <= 1) return safeSend(message, '⚠️ Need at least 2 songs in queue to shuffle.');
    const rest = queue.slice(1);
    for (let i = rest.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    queues.set(guildId, [queue[0], ...rest]);
    await updateNowPlayingMessage(guildId);
    return safeSend(message, '🔀 Queue shuffled!');
  }

  if (command === 'loop') {
    const mode = args[0]?.toLowerCase();
    const currentMode = loopModes.get(guildId) || 0;
    let newMode = currentMode;
    let modeText = '';

    if (mode === 'off' || mode === 'none') {
      newMode = 0;
      modeText = '🔁 Loop disabled';
    } else if (mode === 'single' || mode === 'song') {
      newMode = 1;
      modeText = '🔂 Loop: Single song';
    } else if (mode === 'queue' || mode === 'all') {
      newMode = 2;
      modeText = '🔁 Loop: Entire queue';
    } else {
      newMode = (currentMode + 1) % 3;
      modeText = ['🔁 Loop disabled', '🔂 Loop: Single song', '🔁 Loop: Entire queue'][newMode];
    }

    loopModes.set(guildId, newMode);
    await updateNowPlayingMessage(guildId);
    return safeSend(message, modeText);
  }

  if (command === 'nowplaying' || command === 'np') {
    const current = currentSongs.get(guildId);
    const queue = queues.get(guildId) || [];
    if (!current) {
      const embed = new EmbedBuilder().setColor(0xff0000).setTitle('🎵 Music Player').setDescription('No song currently playing');
      const msg = await safeSend(message, { embeds: [embed], components: createMusicControls(guildId, true) });
      if (msg) nowPlayingMessages.set(guildId, { message: msg, channel: message.channel });
      return;
    }
    const loopMode = loopModes.get(guildId) || 0;
    const loopText = ['', '🔂', '🔁'][loopMode];
    const embed = new EmbedBuilder()
      .setColor(0x00ff00)
      .setTitle('🎵 Now Playing')
      .setDescription(`**${current.title}** ${loopText}`)
      .addFields(
        { name: 'Duration', value: String(current.duration || 'Unknown'), inline: true },
        { name: 'Queue', value: `${queue.length} song(s)`, inline: true },
        { name: 'Loop', value: ['Off', 'Single', 'Queue'][loopMode] || 'Off', inline: true }
      )
      .setFooter({ text: 'Use the buttons below to control playback' });
    const msg = await safeSend(message, { embeds: [embed], components: createMusicControls(guildId, false) });
    if (msg) nowPlayingMessages.set(guildId, { message: msg, channel: message.channel });
    return;
  }

  if (command === 'queue' || command === 'q') {
    const queue = queues.get(guildId) || [];
    const current = currentSongs.get(guildId);
    if (!queue.length && !current) return safeSend(message, '📭 Queue is empty.');
    const loopMode = loopModes.get(guildId) || 0;
    const loopText = ['', ' 🔂', ' 🔁'][loopMode];
    let queueText = '';
    if (current) queueText += `**Now Playing:**\n▶️ ${current.title}${loopText}\n\n`;
    if (queue.length > 0) {
      queueText += '**Up Next:**\n';
      queue.slice(0, 10).forEach((song, index) => {
        queueText += `${index + 1}. ${song.title}\n`;
      });
      if (queue.length > 10) queueText += `\n... and ${queue.length - 10} more songs`;
    }
    return safeSend(message, { embeds: [new EmbedBuilder().setColor(0xffff00).setTitle('📋 Music Queue').setDescription(queueText).setFooter({ text: `Total songs in queue: ${queue.length}` })] });
  }

  if (command === 'clear') {
    const queue = queues.get(guildId) || [];
    if (!queue.length) return safeSend(message, '⚠️ Queue is already empty.');
    queues.set(guildId, []);
    await updateNowPlayingMessage(guildId);
    return safeSend(message, '🗑️ Queue cleared!');
  }

  if (command === 'remove' || command === 'rm') {
    const position = parseInt(args[0], 10);
    const queue = queues.get(guildId) || [];
    if (!position || position < 1 || position > queue.length) return safeSend(message, `⚠️ Please provide a valid position (1-${queue.length})`);
    const removed = queue.splice(position - 1, 1)[0];
    await updateNowPlayingMessage(guildId);
    return safeSend(message, `🗑️ Removed: **${removed.title}**`);
  }

  if (command === 'play' || command === 'playnext' || command === 'pn') {
    const query = args.join(' ');
    if (!query) return safeSend(message, '⚠️ Provide a YouTube URL or search term.');
    const vc = message.member?.voice?.channel;
    if (!vc) return safeSend(message, '⚠️ Join a voice channel first.');
    musicChannels.set(guildId, message.channel);
    queues.set(guildId, queues.get(guildId) || []);
    const queue = queues.get(guildId);
    const isPlayNext = command === 'playnext' || command === 'pn';
    let added = false;

    const userId = message.author.id;
    const savedPlaylists = await getUserPlaylists(userId);
    if (savedPlaylists[query]) {
      const playlist = savedPlaylists[query];
      if (!playlist.length) return safeSend(message, `📭 Playlist **${query}** is empty.`);
      playlist.forEach((song) => queue.push(song));
      safeSend(message, {
        embeds: [
          new EmbedBuilder()
            .setColor(0x9b59b6)
            .setTitle('✅ Playlist Loaded')
            .setDescription(`Loaded **${playlist.length}** song(s) from **${query}**`)
            .setFooter({ text: `Queue position: ${queue.length - playlist.length + 1}-${queue.length}` }),
        ],
      });
      const guildPlayer = getOrCreatePlayer(guildId);
      if (guildPlayer.state.status !== AudioPlayerStatus.Playing) {
        return playNext(vc, message);
      }
      return;
    }

    const loadingMsg = await safeSend(message, '🔍 Searching...');
    if (/list=/.test(query)) {
      if (isPlayNext) {
        if (loadingMsg?.delete) loadingMsg.delete().catch(() => {});
        return safeSend(message, '⚠️ Playlists are not supported for `!playnext`. Use `!play` instead.');
      }
      added = await addPlaylist(query, queue, message);
    } else if (/^https?:\/\//.test(query)) {
      added = await addSingle(query, queue, message, isPlayNext);
    } else {
      added = await addSearch(query, queue, message, isPlayNext);
    }
    if (loadingMsg?.delete) loadingMsg.delete().catch(() => {});
    const guildPlayer = getOrCreatePlayer(guildId);
    if (added && guildPlayer.state.status !== AudioPlayerStatus.Playing) {
      return playNext(vc, message);
    }
    if (added) {
      if (isPlayNext && queue.length > 1) {
        safeSend(message, `⏭️ Added to play next: **${queue[1].title}**`);
      } else if (isPlayNext && queue.length === 1) {
        safeSend(message, `⏭️ Added to play next: **${queue[0].title}**`);
      } else {
        safeSend(message, `➕ Added to queue (position ${queue.length}): **${queue[queue.length - 1].title}**`);
      }
      await updateNowPlayingMessage(guildId);
    }
  }

  if (command === 'previous' || command === 'prev') {
    const vc = message.member?.voice?.channel;
    if (!vc) return safeSend(message, '⚠️ Join a voice channel first.');
    const history = songHistory.get(guildId) || [];
    if (!history.length) return safeSend(message, '⚠️ No previous songs in history.');
    safeSend(message, '⏮️ Going to previous song...');
    await playPrevious(vc, message);
  }

  if (command === 'skip') {
    const current = currentSongs.get(guildId);
    if (!current) return safeSend(message, '⚠️ Nothing is currently playing.');
    const player = players.get(guildId);
    if (player) player.stop();
    return safeSend(message, `⏭️ Skipped: **${current.title}**`);
  }

  if (command === 'stop') {
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
    if (stopStream) {
      try {
        stopStream.kill('SIGKILL');
      } catch (_) {}
      activeStreams.delete(guildId);
    }
    const player = players.get(guildId);
    if (player) {
      player.stop();
      players.delete(guildId);
    }
    await updateNowPlayingMessage(guildId);
    return safeSend(message, '⏹️ Stopped playback, cleared queue, and left voice channel.');
  }
}

module.exports = {
  handleMessage,
  handleInteraction,
  prefix,
  slashCommands,
};