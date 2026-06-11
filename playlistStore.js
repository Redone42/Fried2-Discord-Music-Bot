const fs = require('fs').promises;
const path = require('path');

const PLAYLIST_FILE = path.join(__dirname, 'user_playlists.json');
let userPlaylists = {};

(async function loadPlaylists() {
  try {
    const raw = await fs.readFile(PLAYLIST_FILE, 'utf8');
    userPlaylists = JSON.parse(raw);
    console.log(`✅ Loaded playlists for ${Object.keys(userPlaylists).length} users`);
  } catch (error) {
    if (error.code === 'ENOENT') {
      userPlaylists = {};
      console.log('ℹ️ Playlist storage not found. Starting fresh.');
    } else {
      console.error('Error loading playlists:', error);
      userPlaylists = {};
    }
  }
})();

async function savePlaylists() {
  try {
    await fs.writeFile(PLAYLIST_FILE, JSON.stringify(userPlaylists, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('Error saving playlists:', error);
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

module.exports = {
  getUserPlaylists,
  saveUserPlaylists,
};