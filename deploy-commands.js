require('dotenv').config();
const { REST, Routes } = require('discord.js');
const { slashCommands } = require('./commands');

const token = process.env.TOKEN;
const clientId = process.env.CLIENT_ID;

if (!token || !clientId) {
  console.error('Missing environment variables. Please add TOKEN and CLIENT_ID to your .env file.');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
  try {
    console.log(`Deploying ${slashCommands.length} global slash commands...`);
    await rest.put(Routes.applicationCommands(clientId), { body: slashCommands });
    console.log('✅ Global slash commands deployed successfully.');
    console.log('Note: global commands can take up to 1 hour to appear in all servers.');
  } catch (error) {
    console.error('Failed to deploy slash commands:', error);
    process.exit(1);
  }
})();
