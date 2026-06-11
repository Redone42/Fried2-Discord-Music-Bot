const axios = require('axios');

const GENIUS_ACCESS_TOKEN = process.env.GENIUS_API_KEY;
const GENIUS_API_BASE = 'https://api.genius.com';

async function searchLyrics(query) {
  if (!GENIUS_ACCESS_TOKEN) {
    console.error('Genius API key is not configured in .env');
    return null;
  }

  const cleanQuery = query
    .replace(/\([^)]*\)/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/(official|music|video|audio|lyric|lyrics)/gi, '')
    .replace(/[-_]/g, ' ')
    .trim();

  try {
    const searchResponse = await axios.get(`${GENIUS_API_BASE}/search`, {
      headers: { Authorization: `Bearer ${GENIUS_ACCESS_TOKEN}` },
      params: { q: cleanQuery },
    });

    const hits = searchResponse.data.response.hits || [];
    if (!hits.length) return null;

    const song = hits[0].result;
    const songResponse = await axios.get(`${GENIUS_API_BASE}/songs/${song.id}`, {
      headers: { Authorization: `Bearer ${GENIUS_ACCESS_TOKEN}` },
    });

    const songDetails = songResponse.data.response.song;
    return {
      title: songDetails.title,
      artist: songDetails.primary_artist.name,
      album: songDetails.album ? songDetails.album.name : null,
      releaseDate: songDetails.release_date_for_display,
      url: songDetails.url,
      thumbnail: songDetails.song_art_image_thumbnail_url,
    };
  } catch (error) {
    console.error('Genius API error:', error.response?.data || error.message);
    return null;
  }
}

module.exports = { searchLyrics };