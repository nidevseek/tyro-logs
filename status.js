const { Client, GatewayIntentBits, Partials, Events } = require('discord.js');
const fs = require('fs');
const path = require('path');

const TOKEN = '';
const WATCH_BOT_ID = '';
const CHANNEL_ID = '';
const PING_USER_ID = '';

let lastState = null;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildMembers
    ],
    partials: [Partials.User]
});

client.once(Events.ClientReady, () => {
    console.log(`Бот запущен как ${client.user.tag}`);
    client.user.setActivity('за онлайном Tyro', {
        type: 3
    });
});
client.on(Events.PresenceUpdate, async (oldPresence, newPresence) => {
    if (!newPresence) return;
    if (newPresence.userId !== WATCH_BOT_ID) return;

    const isOnline = newPresence.status !== 'offline';
    if (lastState === null) {
        lastState = isOnline;
        return;
    }

    if (isOnline !== lastState) {
        const channel = await client.channels.fetch(CHANNEL_ID);
        if (!channel) return;

        const pingMessage = await channel.send(`<@${PING_USER_ID}> Bot status changed`);

        setTimeout(async () => {
            try {
                await pingMessage.delete();
            } catch (err) {
                console.error('Failed to delete ping message:', err);
            }

            const imagePath = path.join(__dirname, 'img', isOnline ? 'bot-on.png' : 'bot-off.png');

            if (!fs.existsSync(imagePath)) {
                console.error(`File not found: ${imagePath}`);
                return;
            }

            await channel.send({ files: [imagePath] });
        }, 5000);

        lastState = isOnline;
    }
});

client.login(TOKEN);
