require('dotenv').config();
const fs = require('fs');
const axios = require('axios');
const path = require('path');
const { Client, Collection, REST, Routes, GatewayIntentBits, Partials, EmbedBuilder, ActivityType, MessageFlags } = require('discord.js');
const sqlite3 = require('sqlite3');


const NETWORK_ERROR_PATTERNS = [
    'ConnectTimeoutError',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'ECONNRESET',
    'ENOTFOUND',
    'getaddrinfo ENOTFOUND'
];

let lastRestartTime = 0;
const RESTART_COOLDOWN = 300000;
function shouldRestart() {
    const now = Date.now();
    return (now - lastRestartTime) > RESTART_COOLDOWN;
}

function restartBot(reason) {
    if (!shouldRestart()) {
        console.log(`⏳ Пропускаем перезапуск - кулдаун (${Math.floor(RESTART_COOLDOWN / 1000)} сек)`);
        return;
    }
    
    console.log(`🔄 ${reason}`);
    lastRestartTime = Date.now();
    
    process.exit(0);
}


process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:');
    console.error('   Message:', error.message);
    console.error('   Stack:', error.stack);
    
    const isNetworkError = NETWORK_ERROR_PATTERNS.some(pattern => 
        error.message.includes(pattern)
    );
  
    if (isNetworkError) {
        restartBot('⚠️ Обнаружена ошибка сети: ' + error.message);
    } else {
        restartBot('⚠️ Критическая ошибка: ' + error.message);
    }
});

process.on('unhandledRejection', (reason, promise) => {
    const errorMessage = reason?.message || String(reason);
    const errorStack = reason?.stack || 'No stack trace';
    
    console.error('❌ Unhandled Rejection:');
    console.error('   Message:', errorMessage);
    console.error('   Stack:', errorStack);
    console.error('   Reason:', reason);
    
    const isNetworkError = NETWORK_ERROR_PATTERNS.some(pattern => 
        errorMessage.includes(pattern)
    );
  
    if (isNetworkError) {
        restartBot('⚠️ Обнаружена ошибка сети: ' + errorMessage);
    } else {
        restartBot('⚠️ Обнаружена необработанная ошибка: ' + errorMessage);
    }
});

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildInvites,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildScheduledEvents,
        GatewayIntentBits.GuildEmojisAndStickers,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildBans,
        GatewayIntentBits.DirectMessageReactions
    ],
    partials: [
        Partials.User,
        Partials.GuildMember,
        Partials.Message,
        Partials.Channel,
        Partials.Reaction
    ]
});


client.on('error', (error) => {
    console.error('❌ Discord.js Client Error:', error.message);
    
    const isNetworkError = NETWORK_ERROR_PATTERNS.some(pattern => 
        error.message.includes(pattern)
    );
  
    if (isNetworkError) {
        restartBot('⚠️ Ошибка подключения Discord: ' + error.message);
    }
});

client.on('warn', (warning) => {
    console.warn('⚠️ Discord.js Warning:', warning);
});


client.once('clientReady', () => {
    console.log(`Бот ${client.user.tag} запущен!`);

    const updateStatus = () => {
        const guildsCount = client.guilds.cache.size;
        const userCount = client.guilds.cache.reduce((total, guild) => total + guild.memberCount, 0);

        client.user.setPresence({
            status: 'idle',
            activities: [
                {
                    name: `🦊 ${userCount} пользователей | ${guildsCount} серверов`,
                    type: ActivityType.Custom 
                }
            ]
        });
    };

    updateStatus();

    setInterval(() => {
        if (client.channels.cache.size > 50000) {
            const channelsToSweep = client.channels.cache.filter(c => c && !c.guild?.members.cache.has(client.user.id));
            channelsToSweep.forEach(c => client.channels.cache.delete(c.id));
        }
        if (client.users.cache.size > 100000) {
            const usersToSweep = client.users.cache.filter(u => !client.guilds.cache.some(g => g.members.cache.has(u.id)));
            usersToSweep.forEach(u => client.users.cache.delete(u.id));
        }
    }, 30 * 60 * 1000);
});

const versionBot = "v0.1.21.7";
const dataPath = path.join(__dirname, 'db', 'stats.json');
require('./logs/event.js')(client, getGuildLang, incrementLogsSent);

if (!fs.existsSync(dataPath)) {
    fs.writeFileSync(dataPath, JSON.stringify({ commandsHandled: 0, LogCount: 0 }, null, 4));
}


function getStats() {
    try { return JSON.parse(fs.readFileSync(dataPath, 'utf8')); } 
    catch { return { commandsHandled: 0, LogCount: 0 }; }
}

function saveStats(stats) { fs.writeFileSync(dataPath, JSON.stringify(stats, null, 4)); }
function incrementCommandsHandled() { const stats = getStats(); stats.commandsHandled++; saveStats(stats); }
function incrementLogsSent() { const stats = getStats(); stats.LogCount++; saveStats(stats); }
function getFormattedStats() { const stats = getStats(); return { formattedCommandsHandled: stats.commandsHandled, formattedLogHandled: stats.LogCount }; }

const dbLang = new sqlite3.Database('./db/lang.db', err => { if (err) console.error(err); });
dbLang.run(`CREATE TABLE IF NOT EXISTS guilds (guildID TEXT PRIMARY KEY, guildName TEXT, lang TEXT DEFAULT 'ru')`);
dbLang.configure('busyTimeout', 5000);

const dbBanned = new sqlite3.Database('./db/banned.db', err => { if (err) console.error(err); });
dbBanned.run(`CREATE TABLE IF NOT EXISTS banned_guilds (guildID TEXT PRIMARY KEY, reason TEXT DEFAULT 'No reason')`);
dbBanned.run(`CREATE TABLE IF NOT EXISTS banned_users (userID TEXT PRIMARY KEY, reason TEXT DEFAULT 'No reason')`);
dbBanned.configure('busyTimeout', 5000);

const dbLogs = new sqlite3.Database('./db/logs.db', err => { if (err) console.error(err); });
dbLogs.run(` CREATE TABLE IF NOT EXISTS logs_settings ( guildID TEXT PRIMARY KEY, channelID TEXT, channelName TEXT, guildName TEXT, authorName TEXT, authorID TEXT)`);
dbLogs.run(`CREATE INDEX IF NOT EXISTS idx_logs_settings_guild ON logs_settings(guildID)`);
dbLogs.configure('busyTimeout', 5000);

const dbSettings = new sqlite3.Database('./db/settings.db');
dbSettings.run(`CREATE TABLE IF NOT EXISTS logs (
    category TEXT,
    server_name TEXT,
    server_id TEXT,
    channel_name TEXT,
    channel_id TEXT,
    enabled INTEGER
)`);
dbSettings.run(`CREATE INDEX IF NOT EXISTS idx_logs_server_category ON logs(server_id, category)`);
dbSettings.run(`CREATE INDEX IF NOT EXISTS idx_logs_enabled ON logs(enabled)`);
dbSettings.run(`CREATE TABLE IF NOT EXISTS log_ignored_channels (server_id TEXT, channel_id TEXT, PRIMARY KEY(server_id, channel_id))`);
dbSettings.configure('busyTimeout', 5000);

client.isGuildBanned = guildID => new Promise((resolve, reject) => {
    dbBanned.get(`SELECT guildID FROM banned_guilds WHERE guildID = ?`, [guildID], (err, row) => { if (err) return reject(err); resolve(!!row); });
});

client.isUserBanned = userID => new Promise((resolve, reject) => {
    dbBanned.get(`SELECT userID FROM banned_users WHERE userID = ?`, [userID], (err, row) => { if (err) return reject(err); resolve(!!row); });
});

function getGuildLang(guildID) {
    return new Promise((resolve, reject) => {
        dbLang.get(`SELECT lang FROM guilds WHERE guildID = ?`, [guildID], (err, row) => { if (err) return reject(err); resolve(row?.lang || 'ru'); });
    });
}
client.getGuildLang = getGuildLang;

client.on('messageCreate', message => {
    if (!message.content.startsWith('+') || message.author.bot) return;

    const args = message.content.slice(1).trim().split(/ +/);
    const commandName = args.shift().toLowerCase();

    const command = client.commands.get(commandName);
    if (!command) return;

    command.execute(message, args);
});

client.commands = new Collection();

const allCommandFiles = fs.readdirSync('./cmd').filter(f => f.endsWith('.js'));
const prefixCommands = [];
const slashCommands = [];

for (const file of allCommandFiles) {
    const command = require(`./cmd/${file}`);

    if (command.data && command.data.name) {
        client.commands.set(command.data.name, command);
        slashCommands.push(command);
    } else if (command.name) {
        client.commands.set(command.name, command);
        prefixCommands.push(command);
    } else {
        console.log(`Ошибка в команде ${file} — нет name или data.name`);
    }
}

const eventsPath = path.join(__dirname, 'events');
const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));
for (const file of eventFiles) {
    const filePath = path.join(eventsPath, file);
    const event = require(filePath);
    if (event.name === 'interactionCreate') continue;
    if (event.once) {
        client.once(event.name, (...args) => event.execute(...args, client));
    } else {
        client.on(event.name, (...args) => event.execute(...args, client));
    }
}

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

const utils = { getGuildLang, incrementCommandsHandled, getFormattedStats, versionBot };

(async () => {
    try {
      console.log('Синхронизация глобальных команд...');
  
      await rest.put(
        Routes.applicationCommands(process.env.CLIENT_ID),
        { body: slashCommands.map(cmd => cmd.data.toJSON()) }
    );
  
      console.log(`Готово. Активных команд: ${client.commands.size}`);
    } catch (error) {
      console.error('Ошибка при синхронизации команд:', error);
      sendErrorEmbed(error);
    }
  })();

client.on('interactionCreate', async interaction => {
    if (interaction.isButton?.() || interaction.isStringSelectMenu?.() || interaction.isModalSubmit?.()) return;
    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) return;
    const stats = getFormattedStats();

    await interaction.deferReply({ 
        flags: (command.deferEphemeral ?? false) ? MessageFlags.Ephemeral : 0
    });

    const lang = await getGuildLang(interaction.guild?.id);

    const sendCommandLog = async () => {
        try {
            const logChannel = await client.channels.fetch('');
            if (!logChannel || !logChannel.isTextBased()) return;

            const embed = new EmbedBuilder()
                .setTitle(lang === 'ru' ? 'Команда использована' : 'Command Used')
                .setThumbnail(interaction.guild?.iconURL({ size: 1024, extension: 'webp' }) || 'https://discord.com/assets/411d8a698dd15ddf.png')
                .setColor('#fe983e')
                .addFields(
                    { name: lang === 'ru' ? 'Пользователь' : 'User', value: `<@${interaction.user.id}>`, inline: true },
                    { name: lang === 'ru' ? 'Команда' : 'Command', value: `\`${interaction.commandName}\``, inline: true },
                    { name: lang === 'ru' ? 'Использований' : 'Uses', value: `${stats.formattedCommandsHandled}`, inline: true },
                    { name: lang === 'ru' ? 'Сервер' : 'Guild', value: `${interaction.guild?.name} [\`${interaction.guild?.id}]\``, inline: true },
                    { name: lang === 'ru' ? 'Канал' : 'Channel', value: interaction.channel ? `\`${interaction.channel.name}\`` : 'N/A', inline: true },
                    { name: 'Timestamp', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false }
                );

            logChannel.send({ embeds: [embed] });
        } catch (err) {
            if (err?.code !== 50001) console.error('Ошибка при логировании команды:', err);
        }
    };

    try {
        if (await client.isGuildBanned(interaction.guild?.id)) {
            return interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setThumbnail(interaction.guild?.iconURL({ size: 1024, extension: 'webp' }) || 'https://discord.com/assets/411d8a698dd15ddf.png')
                    .setTitle(lang === 'ru' ? 'Доступ запрещён' : 'Access Denied')
                    .setDescription(lang === 'ru'
                        ? 'Этот сервер заблокирован для использования бота! Если вы считаете это ошибкой, обратитесь в [поддержку](https://discord.gg/)'
                        : 'This server is banned from using the bot! If you believe this is a mistake, contact [support](https://discord.gg/)')
                    .setColor('#fe983e')
                ]
            });
        }

        if (await client.isUserBanned(interaction.user.id)) {
            return interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setThumbnail(interaction.guild?.iconURL({ size: 1024, extension: 'webp' }) || 'https://discord.com/assets/411d8a698dd15ddf.png')
                    .setTitle(lang === 'ru' ? 'Доступ запрещён' : 'Access Denied')
                    .setDescription(lang === 'ru'
                        ? 'Вы заблокированы для использования бота! Если вы считаете это ошибкой, обратитесь в [поддержку](https://discord.gg/)'
                        : 'You are banned from using the bot! If you believe this is a mistake, contact [support](https://discord.gg/)')
                    .setColor('#fe983e')
                ]
            });
        }
        
        if (!interaction.guild) {
            return interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setThumbnail(interaction.guild?.iconURL({ size: 1024, extension: 'webp' }) || 'https://discord.com/assets/411d8a698dd15ddf.png')
                    .setTitle('Доступ запрещён')
                    .setDescription('Эта команда доступна только на сервере.')
                    .setColor('#fe983e')
                ]
            });
        }

        if (!interaction.options) {
            return interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setTitle(lang === 'ru' ? 'Ошибка' : 'Error')
                    .setDescription(lang === 'ru' ? 'Неверный тип взаимодействия.' : 'Invalid interaction type.')
                    .setColor('#fe983e')
                ]
            });
        }

        await command.execute(interaction, client, utils);

        sendCommandLog();

    } catch (error) {
        try {
            const errPayload = {
                embeds: [new EmbedBuilder()
                    .setThumbnail(interaction.guild?.iconURL({ size: 1024, extension: 'webp' }) || 'https://discord.com/assets/411d8a698dd15ddf.png')
                    .setTitle(lang === 'ru' ? 'Что-то пошло не так' : 'Something went wrong')
                    .setDescription(lang === 'ru'
                        ? 'Произошла ошибка при выполнении команды. Попробуйте снова или обратитесь в поддержку.'
                        : 'An error occurred while executing the command. Try again or contact support.')
                    .setColor('#fe983e')
                ]
            };
            if (interaction.deferred) {
                await interaction.editReply(errPayload);
            } else {
                await interaction.reply({ ...errPayload, flags: MessageFlags.Ephemeral });
            }
        } catch (_) {}
        sendErrorEmbed(error, interaction);
    }
});


async function sendErrorEmbed(error, interaction = null) {
    try {
        const lang = await getGuildLang(interaction?.guild?.id);
        const errorEmbed = new EmbedBuilder()
            .setTitle(lang === 'ru' ? 'Произошла ошибка!' : 'Error Occurred!')
            .setDescription(`\`\`\`${error.stack || error}\`\`\``)
            .setColor('#fe983e')
            .setTimestamp()
            .setFooter({ text: lang === 'ru' ? 'Лог ошибок бота' : 'Bot error log' });

        if (interaction) {
            errorEmbed.addFields(
                { name: lang === 'ru' ? 'Сервер' : 'Server', value: `${interaction.guild?.name || 'DM'} (${interaction.guild?.id || 'N/A'})`, inline: true },
                { name: lang === 'ru' ? 'Пользователь' : 'User', value: `${interaction.user.tag} (${interaction.user.id})`, inline: true },
                { name: lang === 'ru' ? 'Команда' : 'Command', value: `${interaction.commandName || 'N/A'}`, inline: true }
            );
        }

        if (!client.isReady()) {
            console.error('Client not ready, cannot send error embed');
            return;
        }

        const logChannel = await client.channels.fetch('');
        if (logChannel && logChannel.isTextBased()) {
            logChannel.send({ embeds: [errorEmbed] });
        }
    } catch (err) {
        console.error('Не удалось отправить Embed с ошибкой:', err);
    }
}

client.on('interactionCreate', async (interaction) => {
    const event = require('./events/interactionCreate');
    await event.execute(interaction, client, { getGuildLang, incrementCommandsHandled, getFormattedStats });
});

client.dbLang = dbLang;
client.login(process.env.TOKEN);
