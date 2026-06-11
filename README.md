<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:var(--font-sans)}
.hero{padding:2rem 0 1.5rem;border-bottom:0.5px solid var(--color-border-tertiary);margin-bottom:1.5rem}
.hero h1{font-size:22px;font-weight:500;color:var(--color-text-primary);margin-bottom:6px}
.hero p{font-size:15px;color:var(--color-text-secondary);line-height:1.6;max-width:560px}
.badge{display:inline-block;font-size:11px;font-weight:500;padding:3px 8px;border-radius:var(--border-radius-md);margin-right:6px;margin-top:8px}
.b-purple{background:#EEEDFE;color:#3C3489}
.b-teal{background:#E1F5EE;color:#085041}
.b-blue{background:#E6F1FB;color:#0C447C}
.section-title{font-size:13px;font-weight:500;color:var(--color-text-secondary);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:10px;margin-top:1.5rem}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-bottom:1.5rem}
.card{background:var(--color-background-primary);border:0.5px solid var(--color-border-tertiary);border-radius:var(--border-radius-lg);padding:14px 16px}
.card-icon{font-size:20px;color:var(--color-text-secondary);margin-bottom:8px}
.card h3{font-size:14px;font-weight:500;color:var(--color-text-primary);margin-bottom:4px}
.card p{font-size:12px;color:var(--color-text-secondary);line-height:1.5}
.cmd-table{width:100%;border-collapse:collapse;font-size:13px;margin-bottom:1.5rem}
.cmd-table tr{border-bottom:0.5px solid var(--color-border-tertiary)}
.cmd-table tr:last-child{border-bottom:none}
.cmd-table td{padding:8px 6px;color:var(--color-text-primary);vertical-align:top}
.cmd-table td:first-child{font-family:var(--font-mono);font-size:12px;color:#185FA5;white-space:nowrap;width:1%}
.cmd-table td:last-child{color:var(--color-text-secondary)}
.stack-row{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:1.5rem}
.tech-pill{background:var(--color-background-secondary);border:0.5px solid var(--color-border-tertiary);border-radius:20px;padding:5px 12px;font-size:12px;color:var(--color-text-secondary)}
.divider{height:0.5px;background:var(--color-border-tertiary);margin:1.5rem 0}
</style>

<div class="hero">
  <h1>🎵 Discord music bot</h1>
  <p>A self-hosted, multi-guild music bot for Discord. Stream audio from YouTube directly into voice channels, manage queues, save personal playlists, and control playback with interactive buttons — all with a single prefix command.</p>
  <span class="badge b-purple">discord.js v14</span>
  <span class="badge b-teal">yt-dlp-exec</span>
  <span class="badge b-blue">Genius API</span>
</div>

<div class="section-title">Core features</div>
<div class="grid">
  <div class="card">
    <div class="card-icon"><i class="ti ti-player-play" aria-hidden="true"></i></div>
    <h3>Playback</h3>
    <p>Stream audio from YouTube URLs, search terms, or playlists with low-latency yt-dlp piping.</p>
  </div>
  <div class="card">
    <div class="card-icon"><i class="ti ti-list" aria-hidden="true"></i></div>
    <h3>Queue management</h3>
    <p>Add, remove, skip, shuffle, and reorder songs. Play-next support to jump the queue.</p>
  </div>
  <div class="card">
    <div class="card-icon"><i class="ti ti-refresh" aria-hidden="true"></i></div>
    <h3>Loop modes</h3>
    <p>Three modes: off, single-song repeat, or full queue loop — toggled per guild.</p>
  </div>
  <div class="card">
    <div class="card-icon"><i class="ti ti-history" aria-hidden="true"></i></div>
    <h3>Song history</h3>
    <p>Go back to previously played tracks with the <code style="font-size:11px">!prev</code> command or ⏮️ button.</p>
  </div>
  <div class="card">
    <div class="card-icon"><i class="ti ti-playlist" aria-hidden="true"></i></div>
    <h3>Saved playlists</h3>
    <p>Per-user playlists stored as JSON. Create, add, remove, and play them at any time.</p>
  </div>
  <div class="card">
    <div class="card-icon"><i class="ti ti-music" aria-hidden="true"></i></div>
    <h3>Lyrics lookup</h3>
    <p>Fetches song metadata and Genius links for the currently playing track or any search query.</p>
  </div>
</div>

<div class="section-title">Interactive controls</div>
<div class="card" style="margin-bottom:1.5rem">
  <p style="font-size:13px;color:var(--color-text-secondary);line-height:1.7">
    Every now-playing message includes two rows of persistent buttons — ⏮️ Previous, ⏸️ Pause/Resume, ⏭️ Skip, ⏹️ Stop, 🔀 Shuffle, 🔁 Loop toggle, 📋 Queue viewer, 📝 Lyrics, and 🗑️ Clear queue. Buttons update live and disable automatically when nothing is playing.
  </p>
</div>

<div class="section-title">Commands</div>
<div class="card" style="margin-bottom:1.5rem">
  <table class="cmd-table">
    <tr><td>!play &lt;query&gt;</td><td>Play a YouTube URL, search term, or saved playlist name</td></tr>
    <tr><td>!playnext &lt;query&gt;</td><td>Add a song to play immediately after the current one</td></tr>
    <tr><td>!skip</td><td>Skip the currently playing song</td></tr>
    <tr><td>!prev / !previous</td><td>Go back to the last played song</td></tr>
    <tr><td>!stop</td><td>Stop playback, clear the queue, and leave the channel</td></tr>
    <tr><td>!queue / !q</td><td>Show the full current queue</td></tr>
    <tr><td>!shuffle</td><td>Randomly shuffle the queue (keeps current song)</td></tr>
    <tr><td>!loop [off/single/queue]</td><td>Set or cycle through loop modes</td></tr>
    <tr><td>!nowplaying / !np</td><td>Show the now-playing card with all controls</td></tr>
    <tr><td>!clear</td><td>Clear the queue without stopping current song</td></tr>
    <tr><td>!remove &lt;#&gt;</td><td>Remove a specific song from the queue by position</td></tr>
    <tr><td>!lyrics [query]</td><td>Get Genius song info for the current or searched song</td></tr>
    <tr><td>!playlist &lt;sub&gt;</td><td>Manage saved playlists (create / add / list / show / delete / remove)</td></tr>
  </table>
</div>

<div class="section-title">Tech stack</div>
<div class="stack-row">
  <span class="tech-pill">Node.js</span>
  <span class="tech-pill">discord.js v14</span>
  <span class="tech-pill">@discordjs/voice</span>
  <span class="tech-pill">yt-dlp-exec</span>
  <span class="tech-pill">axios</span>
  <span class="tech-pill">Genius REST API</span>
  <span class="tech-pill">dotenv</span>
  <span class="tech-pill">fs (JSON persistence)</span>
</div>

<div class="section-title">Architecture notes</div>
<div class="card">
  <p style="font-size:13px;color:var(--color-text-secondary);line-height:1.7">
    All state (players, queues, connections, loop modes, history, playlists) is scoped per guild ID, enabling the bot to run correctly across multiple servers simultaneously. Audio is streamed directly from yt-dlp as a piped process — no intermediate file download. Playlists persist to <code style="font-size:11px">user_playlists.json</code> on disk and are loaded at startup.
  </p>
</div>
