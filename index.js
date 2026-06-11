require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { handleMessage, handleInteraction } = require('./commands');
const { setClient } = require('./musicPlayer');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

setClient(client);

client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

client.on('messageCreate', handleMessage);
client.on('interactionCreate', handleInteraction);

client.login(process.env.TOKEN).catch((error) => console.error('Login failed:', error));