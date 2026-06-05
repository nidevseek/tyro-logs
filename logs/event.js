const {
    Events,
    EmbedBuilder,
    PermissionFlagsBits,
    AuditLogEvent,
    AttachmentBuilder,
    WebhookClient,
    ChannelType,
    AutoModerationActionType,
    TextDisplayBuilder,
    ContainerBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    SectionBuilder,
    ThumbnailBuilder,
    MessageFlags
} = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
const moment = require('moment');
const { debounce } = require('lodash');
const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

const dbLogs = new sqlite3.Database('./db/logs.db', err => {
    if (err) console.error('Ошибка подключения к БД:', err);
});
dbLogs.configure('busyTimeout', 5000);
dbLogs.run(`CREATE INDEX IF NOT EXISTS idx_logs_settings_guild ON logs_settings(guildID)`);

const dbVoice = new sqlite3.Database('./db/voice.db', err => {
    if (err) console.error('Ошибка подключения к БД:', err);
});
dbVoice.configure('busyTimeout', 5000);

const db = new sqlite3.Database('./db/logs.db', err => { if (err) console.error(err); });
db.configure('busyTimeout', 5000);

const dbSettings = new sqlite3.Database('./db/settings.db', err => {
    if (err) console.error('Ошибка подключения к settings.db:', err);
});
dbSettings.configure('busyTimeout', 5000);
dbSettings.run(`CREATE INDEX IF NOT EXISTS idx_logs_server_category ON logs(server_id, category)`);
dbSettings.run(`CREATE INDEX IF NOT EXISTS idx_logs_enabled ON logs(enabled)`);
dbSettings.run(`CREATE TABLE IF NOT EXISTS log_ignored_channels (server_id TEXT, channel_id TEXT, PRIMARY KEY(server_id, channel_id))`);

function isValidWebhookUrl(url) {
    return typeof url === 'string' && url.length > 50 &&
        (url.startsWith('https://discord.com/api/webhooks/') || url.startsWith('https://discordapp.com/api/webhooks/'));
}

function isChannelIgnored(guildId, channelId) {
    if (!guildId || !channelId) return Promise.resolve(false);
    return new Promise((resolve) => {
        dbSettings.get(`SELECT 1 FROM log_ignored_channels WHERE server_id = ? AND channel_id = ?`, [guildId, channelId], (err, row) => {
            resolve(!err && !!row);
        });
    });
}

const MESSAGES_FILE = path.join(__dirname, 'messages.json');

function loadMessages() {
    if (!fs.existsSync(MESSAGES_FILE)) return [];
    return JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf8')).messages || [];
}

function saveMessages(messages) {
    fs.writeFileSync(MESSAGES_FILE, JSON.stringify({ messages }, null, 2));
}

function addMessage(msg) {
    const messages = loadMessages();
    messages.push({
        id: msg.id,
        authorId: msg.author.id,
        authorTag: msg.author.tag,
        content: msg.content,
        attachments: msg.attachments.map(a => a.url),
        createdAt: Date.now()
    });
    saveMessages(messages);
}

function getStoredMessageById(id) {
    if (!id) return null;
    const messages = loadMessages();
    return messages.find(m => m.id === id) || null;
}

function upsertStoredMessageFromDiscordMessage(msg) {
    if (!msg || !msg.id || !msg.author) return;
    const messages = loadMessages();
    const index = messages.findIndex(m => m.id === msg.id);

    const record = {
        id: msg.id,
        authorId: msg.author.id,
        authorTag: msg.author.tag,
        content: msg.content || '',
        attachments: msg.attachments?.map ? msg.attachments.map(a => a.url) : [],
        createdAt: msg.createdTimestamp || Date.now()
    };

    if (index !== -1) {
        messages[index] = record;
    } else {
        messages.push(record);
    }

    saveMessages(messages);
}

function cleanupOldMessages() {
    const messages = loadMessages();
    const now = Date.now();
    const fifteenDays = 15 * 24 * 60 * 60 * 1000;

    const filtered = messages.filter(m => now - m.createdAt <= fifteenDays);
    saveMessages(filtered);
}

setInterval(cleanupOldMessages, 12 * 60 * 60 * 1000);

function formatDuration(duration, lang) {
    if (duration < 2000) {
        return lang === 'ru' ? 'несколько сек' : 'less than a second';
    }

    const seconds = Math.floor((duration / 1000) % 60);
    const minutes = Math.floor((duration / (1000 * 60)) % 60);
    const hours = Math.floor((duration / (1000 * 60 * 60)) % 24);
    const days = Math.floor(duration / (1000 * 60 * 60 * 24));

    const ruNom = (n, one, few, many) => {
        if (n % 10 === 1 && n % 100 !== 11) return one;
        if ([2,3,4].includes(n % 10) && ![12,13,14].includes(n % 100)) return few;
        return many;
    };

    const ruAcc = (n, one, few, many, oneAcc) => {
        if (n === 1) return oneAcc;
        if ([2,3,4].includes(n % 10) && ![12,13,14].includes(n % 100)) return few;
        return many;
    };

    if (days > 0) {
        return lang === 'ru'
            ? `${days} ${ruAcc(days, 'день', 'дня', 'дней', 'день')} и ${hours} ${ruAcc(hours, 'час', 'часа', 'часов', 'час')}`
            : `In ${days} day${days > 1 ? 's' : ''} and ${hours} hour${hours > 1 ? 's' : ''}`;
    }

    if (hours > 0) {
        return lang === 'ru'
            ? `${hours} ${ruAcc(hours, 'час', 'часа', 'часов', 'час')} и ${minutes} ${ruAcc(minutes, 'минута', 'минуты', 'минут', 'минуту')}`
            : `In ${hours} hour${hours > 1 ? 's' : ''} and ${minutes} minute${minutes > 1 ? 's' : ''}`;
    }

    if (minutes > 0) {
        return lang === 'ru'
            ? `${minutes} ${ruAcc(minutes, 'минута', 'минуты', 'минут', 'минуту')} и ${seconds} ${ruAcc(seconds, 'секунда', 'секунды', 'секунд', 'секунду')}`
            : `In ${minutes} minute${minutes > 1 ? 's' : ''} and ${seconds} second${seconds > 1 ? 's' : ''}`;
    }

    return lang === 'ru'
        ? ruAcc(seconds, 'секунда', 'секунды', 'секунд', 'секунду')
        : `In ${seconds} second${seconds > 1 ? 's' : ''}`;
}



function formatSlowmode(seconds, lang) {
    if (seconds === 0) return lang === 'ru' ? 'убрано' : 'removed';
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    const parts = [];
    if (d) parts.push(d + (lang === 'ru' ? ' д' : ' d'));
    if (h) parts.push(h + (lang === 'ru' ? ' ч' : ' h'));
    if (m) parts.push(m + (lang === 'ru' ? ' м' : ' m'));
    if (s) parts.push(s + (lang === 'ru' ? ' с' : ' s'));
    return parts.join(' ');
}

const getThumbnail = (message, emoji = null) => {
    if (emoji) {
        if (emoji.id) return `https://cdn.discordapp.com/emojis/${emoji.id}.${emoji.animated ? 'gif' : 'png'}`;
        const codePoint = [...emoji.name].map(c => c.codePointAt(0).toString(16)).join('-');
        return `https://twemoji.maxcdn.com/v/latest/72x72/${codePoint}.png`;
    }
    return message.author?.displayAvatarURL({ dynamic: true, size: 128 }) ||
           message.guild.iconURL({ dynamic: true, size: 128 }) ||
           'https://discord.com/assets/411d8a698dd15ddf.png';
};

function boolToText(value, lang) {
    if (lang === 'ru') return value ? 'Да' : 'Нет';
    return value ? 'Yes' : 'No';
}

function getLogChannel(guildID) {
    return new Promise((resolve, reject) => {
        dbLogs.get(`SELECT channelID FROM logs_settings WHERE guildID = ?`, [guildID], (err, row) => {
            if (err) return reject(err);
            if (!row?.channelID) return resolve(null);
            resolve(row.channelID);
        });
    });
}

function formatVerificationLevel(level, lang) {
    const levels = {
        0: { ru: 'Нет', en: 'None' },
        1: { ru: 'Низкий', en: 'Low' },
        2: { ru: 'Средний', en: 'Medium' },
        3: { ru: 'Высокий', en: 'High' },
        4: { ru: 'Очень высокий', en: 'Very High' }
    };
    return levels[level] ? (lang === 'ru' ? levels[level].ru : levels[level].en) : level;
}

async function sendLogEmbed(guild, embed) {
    if (!guild) return;

    dbLogs.get(`SELECT channelID FROM logs_settings WHERE guildID = ?`, [guild.id], async (err, row) => {
        if (err) return console.error('Ошибка чтения из БД:', err);
        if (!row || !row.channelID) return;

        const channel = guild.channels.cache.get(row.channelID);
        if (!channel) return console.warn(`Канал с ID ${row.channelID} не найден в ${guild.name}`);
        const botMember = await guild.members.fetchMe();

        if (!channel.permissionsFor(botMember)?.has(PermissionFlagsBits.ViewChannel)) return;
        if (!channel.permissionsFor(botMember)?.has(PermissionFlagsBits.SendMessages)) return;

        channel.send({ embeds: [embed] }).catch(console.error);
    });
}

function formatAFKTime(seconds, lang) {
    if (seconds < 60) {
        return `${seconds} ${lang === 'ru' ? (seconds === 1 ? 'секунда' : 'секунд') : (seconds === 1 ? 'second' : 'seconds')}`;
    } else if (seconds < 3600) {
        const minutes = Math.floor(seconds / 60);
        return `${minutes} ${lang === 'ru' ? (minutes === 1 ? 'минута' : 'минут') : (minutes === 1 ? 'minute' : 'minutes')}`;
    } else {
        const hours = Math.floor(seconds / 3600);
        return `${hours} ${lang === 'ru' ? (hours === 1 ? 'час' : 'часов') : (hours === 1 ? 'hour' : 'hours')}`;
    }
}

module.exports = (client, getGuildLang, incrementLogCount) => {

async function sendReactionLogEmbed(guild, embed) {
    dbLogs.get(`SELECT channelID FROM logs_settings WHERE guildID = ?`, [guild.id], async (err, row) => {
        if (!err && row?.channelID) {
            const channel = guild.channels.cache.get(row.channelID);
            if (channel?.isTextBased()) {
                channel.send({ embeds: [embed] }).catch(console.error);
                return;
            }
        }

        dbSettings.get(
            `SELECT channel_id, enabled, mode, webhook_url FROM logs WHERE server_id = ? AND category = ?`,
            [guild.id, 'Реакции'],
            (err2, row2) => {
                if (err2 || !row2?.enabled || !row2.channel_id) return;

                if (row2.mode === 'webhook' && isValidWebhookUrl(row2.webhook_url)) {
                    try {
                        const webhook = new WebhookClient({ url: row2.webhook_url });
                        webhook.send({ embeds: [embed] }).catch(console.error);
                    } catch (err) {
                        if (err?.code !== 'WebhookURLInvalid') console.error('Ошибка при отправке через вебхук:', err);
                    }
                } else {
                    const extraChannel = guild.channels.cache.get(row2.channel_id);
                    if (extraChannel?.isTextBased()) {
                        extraChannel.send({ embeds: [embed] }).catch(console.error);
                    }
                }
            }
        );
    });
}


const handleReaction = async (reaction, user, action) => {
    if (user.bot) return;
    const { message } = reaction;
    if (!message.guild) return;
    const channelId = message.channel?.id || message.channelId;
    if (channelId && (await isChannelIgnored(message.guild.id, channelId))) return;

    const lang = await getGuildLang(message.guild.id);
    incrementLogCount();

    const titleMap = {
        add: lang === 'ru' ? 'Реакция добавлена' : 'Reaction Added',
        remove: lang === 'ru' ? 'Реакция удалена' : 'Reaction Removed'
    };

    const description = lang === 'ru'
        ? `Участник: \`${user.username}\` (<@${user.id}>)\nРеакция: \`${reaction.emoji.toString()}\`\nСообщение: [перейти](${message.url})`
        : `User: \`${user.username}\` (<@${user.id}>)\nReaction: \`${reaction.emoji.toString()}\`\nMessage: [view](${message.url})`;

    const embed = new EmbedBuilder()
        .setTitle(titleMap[action])
        .setDescription(description)
        .setColor('#fe983e')
        .setThumbnail(getThumbnail(message, reaction.emoji))
        .setFooter({ text: formatTime() });

    await sendReactionLogEmbed(message.guild, embed);
};

client.on(Events.MessageReactionAdd, (reaction, user) => handleReaction(reaction, user, 'add'));
client.on(Events.MessageReactionRemove, (reaction, user) => handleReaction(reaction, user, 'remove'));

client.on(Events.MessageReactionRemoveAll, async message => {
    if (!message.guild) return;
    const channelId = message.channel?.id || message.channelId;
    if (channelId && (await isChannelIgnored(message.guild.id, channelId))) return;
    const lang = await getGuildLang(message.guild.id);
    incrementLogCount();

    const description = lang === 'ru'
        ? `Все реакции на сообщение [перейти](${message.url}) были удалены.`
        : `All reactions on message [view](${message.url}) were removed.`;

    const embed = new EmbedBuilder()
        .setTitle(lang === 'ru' ? 'Все реакции удалены' : 'All Reactions Removed')
        .setDescription(description)
        .setColor('#fe983e')
        .setFooter({ text: formatTime() })
        .setThumbnail(message.author?.displayAvatarURL({ dynamic: true, size: 128 }) ||
                      message.guild.iconURL({ dynamic: true, size: 128 }) ||
                      'https://discord.com/assets/411d8a698dd15ddf.png');

    await sendReactionLogEmbed(message.guild, embed);
});

client.on(Events.MessageReactionRemoveEmoji, async reaction => {
    if (!reaction.message.guild) return;
    const channelId = reaction.message.channel?.id || reaction.message.channelId;
    if (channelId && (await isChannelIgnored(reaction.message.guild.id, channelId))) return;
    const lang = await getGuildLang(reaction.message.guild.id);
    incrementLogCount();

    const description = lang === 'ru'
        ? `Эмодзи \`${reaction.emoji.toString()}\` было удалено со всех сообщений [перейти](${reaction.message.url}).`
        : `Emoji \`${reaction.emoji.toString()}\` was removed from all users on message [view](${reaction.message.url}).`;

    const embed = new EmbedBuilder()
        .setTitle(lang === 'ru' ? 'Эмодзи удалено' : 'Emoji Removed')
        .setDescription(description)
        .setColor('#fe983e')
        .setFooter({ text: formatTime() })
        .setThumbnail(getThumbnail(reaction.message, reaction.emoji));

    await sendReactionLogEmbed(reaction.message.guild, embed);
});


async function sendThreadLogEmbed(guild, embed) {

    dbLogs.get(`SELECT channelID FROM logs_settings WHERE guildID = ?`, [guild.id], async (err, row) => {
        if (!err && row?.channelID) {
            const channel = guild.channels.cache.get(row.channelID);
            if (channel?.isTextBased()) {
                channel.send({ embeds: [embed] }).catch(console.error);
                return;
            }
        }

        dbSettings.get(
            `SELECT channel_id, enabled, mode, webhook_url FROM logs WHERE server_id = ? AND category = ?`,
            [guild.id, 'Треды'],
            (err2, row2) => {
                if (err2 || !row2?.enabled || !row2.channel_id) return;
        
                if (row2.mode === 'webhook' && isValidWebhookUrl(row2.webhook_url)) {
                    try {
                        const webhook = new WebhookClient({ url: row2.webhook_url });
                        webhook.send({ embeds: [embed] }).catch(console.error);
                    } catch (err) {
                        if (err?.code !== 'WebhookURLInvalid') console.error('Ошибка при отправке через вебхук:', err);
                    }
                } else {
                    const extraChannel = guild.channels.cache.get(row2.channel_id);
                    if (extraChannel?.isTextBased()) {
                        extraChannel.send({ embeds: [embed] }).catch(console.error);
                    }
                }
            }
        );
    });
}

// Тред создан
client.on('threadCreate', async thread => {
    if (thread.parentId && (await isChannelIgnored(thread.guild.id, thread.parentId))) return;
    incrementLogCount();
    const lang = await getGuildLang(thread.guild.id);

    let author = 'Не получено';
    try {
        const member = await thread.guild.members.fetch(thread.ownerId);
        if (member) author = `\`${member.user.tag}\` (<@${member.id}>)`;
    } catch {}

    let parentInfo = '—';
    if (thread.parentId) {
        const parent = thread.guild.channels.cache.get(thread.parentId);
        if (parent) parentInfo = `<#${parent.id}>`;
    }

    let threadLink = '';
    if ((thread.type === 11 || thread.type === 12) && thread.parentId) {
        try {
            const starterMessage = await thread.fetchStarterMessage();
            if (starterMessage) {
                threadLink = ` | [${lang === 'ru' ? 'Сообщение' : 'Message'}](https://discord.com/channels/${thread.guild.id}/${thread.id}/${starterMessage.id})`;
            }
        } catch {}
    }
    parentInfo += threadLink;

    const embed = new EmbedBuilder()
        .setColor('#fe983e')
        .setThumbnail(thread.guild.iconURL({ dynamic: true, size: 256 }) || 'https://discord.com/assets/411d8a698dd15ddf.png')
        .setTitle(lang === 'ru' ? 'Создан новый тред' : 'Thread Created')
        .setDescription(lang === 'ru'
            ? `Название: \`${thread.name}\`\nКанал/Сообщение: ${parentInfo}\nАвтор: ${author}`
            : `Name: \`${thread.name}\`\nChannel/Message: ${parentInfo}\nAuthor: ${author}`)
        .setFooter({ text: `${lang === 'ru' ? 'ID треда' : 'Thread ID'}: ${thread.id} | ${formatTime()}` });

    await sendThreadLogEmbed(thread.guild, embed);
});

// Тред удалён
client.on('threadDelete', async thread => {
    if (thread.parentId && thread.guild && (await isChannelIgnored(thread.guild.id, thread.parentId))) return;
    incrementLogCount();
    const lang = await getGuildLang(thread.guild.id);

    let author = 'Не получено';
    try {
        const member = await thread.guild.members.fetch(thread.ownerId);
        if (member) author = `\`${member.user.tag}\` (<@${member.id}>)`;
    } catch {}

    let parentInfo = '—';
    if (thread.parentId) {
        const parent = thread.guild.channels.cache.get(thread.parentId);
        if (parent) parentInfo = `<#${parent.id}>`;
    }

    if ((thread.type === 11 || thread.type === 12) && thread.id && thread.parentId) {
        parentInfo += ` | [${lang === 'ru' ? 'Сообщение' : 'Message'}](https://discord.com/channels/${thread.guild.id}/${thread.parentId}/${thread.id})`;
    }

    const embed = new EmbedBuilder()
        .setColor('#fe983e')
        .setThumbnail(thread.guild.iconURL({ dynamic: true, size: 256 }) || 'https://discord.com/assets/411d8a698dd15ddf.png')
        .setTitle(lang === 'ru' ? 'Тред удалён' : 'Thread Deleted')
        .setDescription(lang === 'ru'
            ? `Название: \`${thread.name}\`\nКанал/Сообщение: ${parentInfo}\nАвтор: ${author}`
            : `Name: \`${thread.name}\`\nChannel/Message: ${parentInfo}\nAuthor: ${author}`)
        .setFooter({ text: `${lang === 'ru' ? 'ID треда' : 'Thread ID'}: ${thread.id} | ${formatTime()}` });

    await sendThreadLogEmbed(thread.guild, embed);
});

// Тред обновлён
client.on('threadUpdate', async (oldThread, newThread) => {
    if (newThread.parentId && (await isChannelIgnored(newThread.guild.id, newThread.parentId))) return;
    incrementLogCount();
    const lang = await getGuildLang(newThread.guild.id);

    let executor = lang === 'ru' ? 'Не получено' : 'Not available';
    try {
        const auditLogs = await newThread.guild.fetchAuditLogs({
            type: AuditLogEvent.ThreadUpdate,
            limit: 1
        });
        const entry = auditLogs.entries.first();
        if (entry && entry.executor) executor = `\`${entry.executor.tag}\` (<@${entry.executor.id}>)`;
    } catch (error) {
        console.error(lang === 'ru' ? 'Ошибка при получении журнала аудита:' : 'Error fetching audit logs:', error);
    }

    const changes = [];
    if (oldThread.name !== newThread.name)
        changes.push(lang === 'ru'
            ? `Название: \`${oldThread.name}\` -> \`${newThread.name}\``
            : `Name: \`${oldThread.name}\` -> \`${newThread.name}\``);
    if (oldThread.rateLimitPerUser !== newThread.rateLimitPerUser)
        changes.push(lang === 'ru'
            ? `Slow mode: \`${oldThread.rateLimitPerUser}s\` -> \`${newThread.rateLimitPerUser}s\``
            : `Slow mode: \`${oldThread.rateLimitPerUser}s\` -> \`${newThread.rateLimitPerUser}s\``);
    if (oldThread.archived !== newThread.archived)
        changes.push(lang === 'ru'
            ? `Архивирован: ${boolToText(oldThread.archived, lang)} -> ${boolToText(newThread.archived, lang)}`
            : `Archived: ${boolToText(oldThread.archived, lang)} -> ${boolToText(newThread.archived, lang)}`);
    if (oldThread.locked !== newThread.locked)
        changes.push(lang === 'ru'
            ? `Заблокирован: ${boolToText(oldThread.locked, lang)} -> ${boolToText(newThread.locked, lang)}`
            : `Locked: ${boolToText(oldThread.locked, lang)} -> ${boolToText(newThread.locked, lang)}`);
    if (changes.length === 0) return;

    const hasNameChange = oldThread.name !== newThread.name;
    const descriptionParts = [];

    if (!hasNameChange) {
        descriptionParts.push(
            lang === 'ru'
                ? `Тред: \`${newThread.name}\``
                : `Thread: \`${newThread.name}\``
        );
    }

    descriptionParts.push(...changes);
    descriptionParts.push(`${lang === 'ru' ? 'Автор' : 'Executor'}: ${executor}`);

    const embed = new EmbedBuilder()
        .setColor('#fe983e')
        .setThumbnail(newThread.guild.iconURL({ dynamic: true, size: 256 }) || 'https://discord.com/assets/411d8a698dd15ddf.png')
        .setTitle(lang === 'ru' ? 'Тред обновлён' : 'Thread Updated')
        .setDescription(descriptionParts.join('\n'))
        .setFooter({ text: `${lang === 'ru' ? 'ID треда' : 'Thread ID'}: ${newThread.id} | ${formatTime()}` });

    await sendThreadLogEmbed(newThread.guild, embed);
});


// эвенты
async function sendEventLogEmbed(guild, embed) {
    dbLogs.get(`SELECT channelID FROM logs_settings WHERE guildID = ?`, [guild.id], async (err, row) => {
        if (!err && row?.channelID) {
            const channel = guild.channels.cache.get(row.channelID);
            if (channel?.isTextBased()) return channel.send({ embeds: [embed] }).catch(console.error);
        }

        dbSettings.get(
            `SELECT channel_id, enabled, mode, webhook_url FROM logs WHERE server_id = ? AND category = ?`,
            [guild.id, 'Эвенты'],
            (err2, row2) => {
                if (err2 || !row2?.enabled || !row2.channel_id) return;
        
                if (row2.mode === 'webhook' && isValidWebhookUrl(row2.webhook_url)) {
                    try {
                        const webhook = new WebhookClient({ url: row2.webhook_url });
                        webhook.send({ embeds: [embed] }).catch(console.error);
                    } catch (err) {
                        if (err?.code !== 'WebhookURLInvalid') console.error('Ошибка при отправке через вебхук:', err);
                    }
                } else {
                    const extraChannel = guild.channels.cache.get(row2.channel_id);
                    if (extraChannel?.isTextBased()) {
                        extraChannel.send({ embeds: [embed] }).catch(console.error);
                    }
                }
            }
        );
    });
}

function getLocation(event, lang) {
    if (event.entityType === 'VOICE_CHANNEL' || event.entityType === 'STAGE_INSTANCE') {
        const channel = event.guild.channels.cache.get(event.channelId);
        return channel ? `#${channel.name}` : lang === 'ru' ? 'Не указано' : 'Not specified';
    } else if (event.entityType === 'EXTERNAL') {
        return event.location || (lang === 'ru' ? 'Не указано' : 'Not specified');
    } else {
        return lang === 'ru' ? 'Не указано' : 'Not specified';
    }
}

client.on('guildScheduledEventCreate', async (event) => {
    const lang = await getGuildLang(event.guild.id);

    const startDate = lang === 'ru'
        ? moment(event.scheduledStartTime).utcOffset(3).format('DD.MM.YYYY - HH:mm')
        : moment(event.scheduledStartTime).format('MM/DD/YYYY - hh:mm A');
    const location = getLocation(event, lang);
    const serverAvatar = event.guild.iconURL({ dynamic: true, size: 256 }) || 'https://discord.com/assets/411d8a698dd15ddf.png';
    const bannerURL = event.image?.url || event.coverImageURL?.({ size: 1024 }) || null;

    let authorText;
    if (event.creatorId) {
        try {
            const member = await event.guild.members.fetch(event.creatorId);
            authorText = member.user.tag;
        } catch {
            authorText = lang === 'ru' ? 'Система' : 'System';
        }
    } else {
        authorText = lang === 'ru' ? 'Система' : 'System';
    }


    const embed = new EmbedBuilder()
        .setColor('#fe983e')
        .setTitle(lang === 'ru' ? 'Создание ивента' : 'Event Created')
        .setThumbnail(serverAvatar)
        .setFooter({ text: lang === 'ru' ? `ID ивента: ${event.id} | ${formatTime()}` : `ID event: ${event.id} | ${formatTime()}` })
        .addFields(
            { name: lang === 'ru' ? 'Название' : 'Name', value: event.name || '-', inline: true },
            { name: lang === 'ru' ? 'Описание' : 'Description', value: event.description || '-', inline: true },
            { name: '', value: '', inline: true },
            { name: lang === 'ru' ? 'Дата' : 'Date', value: `${lang === 'ru' ? 'Начало' : 'Start'}: ${startDate}`, inline: true },
            { name: lang === 'ru' ? (event.entityType === 'VOICE_CHANNEL' ? 'Канал' : 'Локация') : 'Location/Channel', value: location, inline: true },
            { name: '', value: '', inline: true },
            { name: lang === 'ru' ? 'Автор' : 'Author', value: authorText, inline: true },
            { name: lang === 'ru' ? 'Ссылка на ивент' : 'Event Link', value: `[${lang === 'ru' ? 'Перейти' : 'Go'}](${event.url || `https://discord.com/events/${event.guild.id}/${event.id}`})`, inline: true }
        );

    if (bannerURL) embed.setImage(bannerURL);
    await sendEventLogEmbed(event.guild, embed);
});

client.on('guildScheduledEventUpdate', async (oldEvent, newEvent) => {
    const lang = await getGuildLang(newEvent.guild.id);
    const changes = [];
    if (oldEvent.name !== newEvent.name) changes.push({ name: lang === 'ru' ? 'Название' : 'Name', value: `\`${oldEvent.name}\` -> \`${newEvent.name}\``, inline: true });
    if (oldEvent.description !== newEvent.description) changes.push({ name: lang === 'ru' ? 'Описание' : 'Description', value: `\`${oldEvent.description || '-'}\` -> \`${newEvent.description || '-'}\``, inline: true });

    const oldLoc = getLocation(oldEvent, lang);
    const newLoc = getLocation(newEvent, lang);
    if (oldLoc !== newLoc) changes.push({ name: lang === 'ru' ? (newEvent.entityType === 'VOICE_CHANNEL' ? 'Канал' : 'Локация') : 'Location/Channel', value: `${oldLoc} -> ${newLoc}`, inline: true });

    if (changes.length === 0) return;

    const serverAvatar = newEvent.guild.iconURL({ dynamic: true, size: 256 }) || 'https://discord.com/assets/411d8a698dd15ddf.png';
    const bannerURL = newEvent.image?.url || newEvent.coverImageURL?.({ size: 1024 }) || null;

    const embed = new EmbedBuilder()
        .setColor('#fe983e')
        .setTitle(lang === 'ru' ? 'Изменение ивента' : 'Event Edited')
        .setThumbnail(serverAvatar)
        .setFooter({ text: lang === 'ru' ? `ID ивента: ${newEvent.id} | ${formatTime()}` : `ID event: ${newEvent.id} | ${formatTime()}` })
        .addFields(
            ...changes,
            { name: lang === 'ru' ? 'Автор' : 'Author', value: newEvent.user ? newEvent.user.tag : (lang === 'ru' ? 'Система' : 'System'), inline: true },
            { name: lang === 'ru' ? 'Ссылка на ивент' : 'Event Link', value: `[${lang === 'ru' ? 'Перейти' : 'Go'}](${newEvent.url || `https://discord.com/events/${newEvent.guild.id}/${newEvent.id}`})`, inline: true }
        );

    if (bannerURL) embed.setImage(bannerURL);
    await sendEventLogEmbed(newEvent.guild, embed);
});

client.on('guildScheduledEventDelete', async (event) => {
    const lang = await getGuildLang(event.guild.id);

    const startDate = lang === 'ru'
        ? moment(event.scheduledStartTime).utcOffset(3).format('DD.MM.YYYY - HH:mm')
        : moment(event.scheduledStartTime).format('MM/DD/YYYY - hh:mm A');
    const location = getLocation(event, lang);
    const serverAvatar = event.guild.iconURL({ dynamic: true, size: 256 }) || 'https://discord.com/assets/411d8a698dd15ddf.png';
    const bannerURL = event.image?.url || event.coverImageURL?.({ size: 1024 }) || null;

    const embed = new EmbedBuilder()
        .setColor('#fe983e')
        .setTitle(lang === 'ru' ? 'Удаление ивента' : 'Event Deleted')
        .setThumbnail(serverAvatar)
        .setFooter({ text: lang === 'ru' ? `ID ивента: ${event.id} | ${formatTime()}` : `ID event: ${event.id} | ${formatTime()}` })
        .addFields(
            { name: lang === 'ru' ? 'Название' : 'Name', value: event.name || '-', inline: true },
            { name: lang === 'ru' ? 'Описание' : 'Description', value: event.description || '-', inline: true },
            { name: '', value: '', inline: true },
            { name: lang === 'ru' ? 'Дата' : 'Date', value: `${lang === 'ru' ? 'Начало' : 'Start'}: ${startDate}`, inline: true },
            { name: lang === 'ru' ? (event.entityType === 'VOICE_CHANNEL' ? 'Канал' : 'Локация') : 'Location/Channel', value: location, inline: true },
            { name: '', value: '', inline: true },
            { name: lang === 'ru' ? 'Автор' : 'Author', value: event.user ? event.user.tag : (lang === 'ru' ? 'Система' : 'System'), inline: true },
        );

    if (bannerURL) embed.setImage(bannerURL);
    await sendEventLogEmbed(event.guild, embed);
});


// Инвайты
async function sendInviteLogEmbed(guild, embed) {
    const category = 'Инвайты';

    dbLogs.get(`SELECT channelID FROM logs_settings WHERE guildID = ?`, [guild.id], async (err, row) => {
        if (!err && row?.channelID) {
            const channel = guild.channels.cache.get(row.channelID);
            if (channel?.isTextBased()) return channel.send({ embeds: [embed] }).catch(console.error);
        }

        dbSettings.get(
            `SELECT channel_id, enabled, mode, webhook_url FROM logs WHERE server_id = ? AND category = ?`,
            [guild.id, category],
            (err2, row2) => {
                if (err2 || !row2?.enabled || !row2.channel_id) return;
        
                if (row2.mode === 'webhook' && isValidWebhookUrl(row2.webhook_url)) {
                    try {
                        const webhook = new WebhookClient({ url: row2.webhook_url });
                        webhook.send({ embeds: [embed] }).catch(console.error);
                    } catch (err) {
                        if (err?.code !== 'WebhookURLInvalid') console.error('Ошибка при отправке через вебхук:', err);
                    }
                } else {
                    const extraChannel = guild.channels.cache.get(row2.channel_id);
                    if (extraChannel?.isTextBased()) {
                        extraChannel.send({ embeds: [embed] }).catch(console.error);
                    }
                }
            }
        );
    });
}

client.on('inviteCreate', async (invite) => {
    try {
        const channelId = invite.channel?.id ?? invite.channelId;
        if (channelId && (await isChannelIgnored(invite.guild.id, channelId))) return;
        incrementLogCount();
        const lang = await getGuildLang(invite.guild.id);

        const embed = new EmbedBuilder()
            .setColor('#fe983e')
            .setTitle(lang === 'ru' ? 'Создано приглашение' : 'Invitation Created')
            .setThumbnail(invite.guild.iconURL({ dynamic: true, size: 256 }) || 'https://discord.com/assets/411d8a698dd15ddf.png')
            .addFields(
                { name: lang === 'ru' ? 'Кто создал' : 'Created by', value: invite.inviter ? `\`${invite.inviter.tag}\` (<@${invite.inviter.id}>)` : 'System', inline: true },
                { name: lang === 'ru' ? 'Код' : 'Code', value: `\`${invite.code}\` | [${lang === 'ru' ? 'Принять' : 'Accept'}](${invite.url})`, inline: true },
                { name: '', value: '', inline: true },
                { name: lang === 'ru' ? 'Канал' : 'Channel', value: invite.channel ? `\`${invite.channel.name}\` (<#${invite.channel.id}>)` : 'Unknown', inline: true },
                { name: lang === 'ru' ? 'Использованний' : 'Uses', value: `\`${invite.maxUses || '∞'}\` шт`, inline: true },
                { name: '', value: '', inline: true },
                { name: lang === 'ru' ? 'Истекает' : 'Expires At', value: invite.expiresAt ? `<t:${Math.floor(invite.expiresAt / 1000)}:F>` : 'No', inline: true }
            )
            .setFooter({ text: `ID сервера: ${invite.guild.id} | ${formatTime()}` });

        await sendInviteLogEmbed(invite.guild, embed);
    } catch (err) {
        console.error('Ошибка inviteCreate:', err);
    }
});

client.on('inviteDelete', async (invite) => {
    try {
        const channelId = invite.channel?.id ?? invite.channelId;
        if (channelId && (await isChannelIgnored(invite.guild.id, channelId))) return;
        const lang = await getGuildLang(invite.guild.id);

        const cachedInvites = invitesCache.get(invite.guild.id);
        const uses = cachedInvites?.get(invite.code)?.uses || 0;

        const embed = new EmbedBuilder()
            .setColor('#fe983e')
            .setTitle(lang === 'ru' ? 'Приглашение удалено' : 'Invitation Deleted')
            .setThumbnail(invite.guild.iconURL({ dynamic: true, size: 256 }) || 'https://discord.com/assets/411d8a698dd15ddf.png')
            .addFields(
                { name: lang === 'ru' ? 'Кто создал' : 'Created by', value: invite.inviter ? `\`${invite.inviter.tag}\` (<@${invite.inviter.id}>)` : 'System', inline: true },
                { name: lang === 'ru' ? 'Код' : 'Code', value: `\`${invite.code}\``, inline: true },
                { name: '', value: '', inline: true },
                { name: lang === 'ru' ? 'Использований' : 'Uses', value: `\`${uses}\` ${lang === 'ru' ? 'раз' : ''}`, inline: true },
                { name: lang === 'ru' ? 'Канал' : 'Channel', value: invite.channel ? `${invite.channel.name} (<#${invite.channel.id}>)` : 'Unknown', inline: true }
            )
            .setFooter({ text: `ID сервера: ${invite.guild.id} | ${formatTime()}` });

        await sendInviteLogEmbed(invite.guild, embed);

        cachedInvites?.delete(invite.code);
        invitesCache.set(invite.guild.id, cachedInvites);
    } catch (err) {
        console.error('Ошибка inviteDelete:', err);
    }
});

client.on('inviteCreate', async (invite) => {
    const cachedInvites = invitesCache.get(invite.guild.id) || new Map();
    cachedInvites.set(invite.code, invite);
    invitesCache.set(invite.guild.id, cachedInvites);
});

const POLL_INTERVAL = 60000;

const lastRules = new Map();
const lastSoundboardLogId = new Map();


const recentOverwriteCreates = new Map();


function serializeRule(rule) {
    return {
        id: rule.id,
        name: rule.name,
        enabled: rule.enabled,
        triggerType: rule.triggerType,
        actions: JSON.parse(JSON.stringify(rule.actions ?? [])),
        exemptRoles: [...(rule.exemptRoles ?? [])],
        exemptChannels: [...(rule.exemptChannels ?? [])],
        triggerMetadata: JSON.parse(JSON.stringify(rule.triggerMetadata ?? {}))
    };
}

function normalizedForCompare(ser) {
    const meta = ser.triggerMetadata || {};
    const keywordFilter = Array.isArray(meta.keywordFilter) ? [...meta.keywordFilter].sort() : [];
    const presets = Array.isArray(meta.presets) ? [...meta.presets].sort() : [];
    const allowList = Array.isArray(meta.allowList) ? [...meta.allowList].sort() : [];
    const triggerMetadata = { allowList, keywordFilter, presets };
    const actions = (ser.actions || []).slice().sort((a, b) => (a.type - b.type) || (JSON.stringify(a).localeCompare(JSON.stringify(b))));
    const exemptRoles = (ser.exemptRoles || []).slice().sort();
    const exemptChannels = (ser.exemptChannels || []).slice().sort();
    return {
        name: ser.name,
        enabled: ser.enabled,
        triggerType: ser.triggerType,
        actions,
        exemptRoles,
        exemptChannels,
        triggerMetadata
    };
}

function rulesChanged(oldRule, newRule) {
    const a = normalizedForCompare(oldRule);
    const b = normalizedForCompare(newRule);
    return (
        a.name !== b.name ||
        a.enabled !== b.enabled ||
        a.triggerType !== b.triggerType ||
        JSON.stringify(a.actions) !== JSON.stringify(b.actions) ||
        JSON.stringify(a.exemptRoles) !== JSON.stringify(b.exemptRoles) ||
        JSON.stringify(a.exemptChannels) !== JSON.stringify(b.exemptChannels) ||
        JSON.stringify(a.triggerMetadata) !== JSON.stringify(b.triggerMetadata)
    );
}

async function sendAutomodAndSoundLogEmbed(guild, embed, type) {
    let category = type === 'Автомодерация' ? 'Автомодерация' : 'Сервер';

    dbLogs.get(`SELECT channelID FROM logs_settings WHERE guildID = ?`, [guild.id], async (err, row) => {
        if (!err && row?.channelID) {
            const channel = guild.channels.cache.get(row.channelID);
            if (channel?.isTextBased()) return channel.send({ embeds: [embed] }).catch(console.error);
        }

        dbSettings.get(
            `SELECT channel_id, enabled, mode, webhook_url FROM logs WHERE server_id = ? AND category = ?`,
            [guild.id, category],
            (err2, row2) => {
                if (err2 || !row2?.enabled || !row2.channel_id) return;
        
                if (row2.mode === 'webhook' && isValidWebhookUrl(row2.webhook_url)) {
                    try {
                        const webhook = new WebhookClient({ url: row2.webhook_url });
                        webhook.send({ embeds: [embed] }).catch(console.error);
                    } catch (err) {
                        if (err?.code !== 'WebhookURLInvalid') console.error('Ошибка при отправке через вебхук:', err);
                    }
                } else {
                    const fallback = guild.channels.cache.get(row2.channel_id);
                    if (fallback?.isTextBased()) fallback.send({ embeds: [embed] }).catch(console.error);
                }
            }
        );
    });
}

let automodReady = false;
let soundboardReady = false;

client.once('clientReady', async () => {
    for (const guild of client.guilds.cache.values()) {
        try {
            const rules = await guild.autoModerationRules.fetch();
            lastRules.set(
                guild.id,
                new Map(rules.map(r => [r.id, serializeRule(r)]))
            );
        } catch {}

        try {
            const logs = await guild.fetchAuditLogs({ limit: 50 });
            const filtered = logs.entries
                .filter(e => [AuditLogEvent.SoundboardSoundCreate, AuditLogEvent.SoundboardSoundUpdate, AuditLogEvent.SoundboardSoundDelete].includes(e.actionType))
                .sort((a, b) => BigInt(b.id) - BigInt(a.id));

            lastSoundboardLogId.set(guild.id, filtered[0]?.id || null);
        } catch {}
    }

    automodReady = true;
    soundboardReady = true;

    setInterval(() => {
        monitorAutoMod();
        monitorSoundboard();
    }, POLL_INTERVAL);
});


async function monitorAutoMod() {
    if (!automodReady) return;

    for (const guild of client.guilds.cache.values()) {
        try {
            const current = await guild.autoModerationRules.fetch();
            const prev = lastRules.get(guild.id) || new Map();
            const lang = await getGuildLang(guild.id);

            let changed = false;

            for (const [id, rule] of current) {
                if (!prev.has(id)) {
                    await sendAutoModEmbed(guild, 'CREATE', rule, lang);
                    changed = true;
                }
            }

            for (const [id, rule] of current) {
                if (!prev.has(id)) continue;
                const old = prev.get(id);
                const serNew = serializeRule(rule);

                if (rulesChanged(old, serNew)) {
                    await sendAutoModEmbed(guild, 'UPDATE', rule, lang, old);
                    changed = true;
                }
            }

            for (const [id, old] of prev) {
                if (!current.has(id)) {
                    await sendAutoModEmbed(guild, 'DELETE', old, lang);
                    changed = true;
                }
            }

            if (changed) {
                lastRules.set(
                    guild.id,
                    new Map(current.map(r => [r.id, serializeRule(r)]))
                );
            }
        } catch {}
    }
}


async function monitorSoundboard() {
    if (!soundboardReady) return;

    for (const guild of client.guilds.cache.values()) {
        try {
            const lastId = lastSoundboardLogId.get(guild.id);
            const logs = await guild.fetchAuditLogs({ limit: 50 });

            const entries = [...logs.entries.values()]
                .filter(e => [AuditLogEvent.SoundboardSoundCreate, AuditLogEvent.SoundboardSoundUpdate, AuditLogEvent.SoundboardSoundDelete].includes(e.actionType))
                .filter(e => !lastId || BigInt(e.id) > BigInt(lastId))
                .sort((a, b) => BigInt(a.id) - BigInt(b.id));

            for (const entry of entries) {
                await handleSoundboardEntry(guild, entry);
            }

            if (entries.length > 0) {
                const max = entries.reduce((a, b) => (BigInt(a.id) > BigInt(b.id) ? a : b));
                lastSoundboardLogId.set(guild.id, max.id);
            }
        } catch {}
    }
}

async function sendAutoModEmbed(guild, action, rule, lang, oldRule = null) {
    let executor = lang === 'ru' ? '`Неизвестно`' : '`Unknown`';
    let hasRecentAudit = false;

    try {
        const type =
            action === 'CREATE' ? AuditLogEvent.AutoModerationRuleCreate :
            action === 'UPDATE' ? AuditLogEvent.AutoModerationRuleUpdate :
            AuditLogEvent.AutoModerationRuleDelete;

        const logs = await guild.fetchAuditLogs({ type, limit: 5 });
        const entry = logs.entries.find(e => e.target?.id === rule.id);

        if (entry && Date.now() - entry.createdTimestamp < 60_000) {
            hasRecentAudit = true;
            if (entry.executor) {
                executor = entry.executor.bot
                    ? `\`${entry.executor.tag} (bot)\` (<@${entry.executor.id}>)`
                    : `\`${entry.executor.tag}\` (<@${entry.executor.id}>)`;
            }
        }
    } catch {}

    if (action === 'UPDATE' && !hasRecentAudit) return;

    const triggerMap = {
        1: { ru: 'Ключевые слова', en: 'Keywords' },
        2: { ru: 'Спам', en: 'Spam' },
        3: { ru: 'Ссылки', en: 'Links' },
        4: { ru: 'Упоминания', en: 'Mentions' },
        5: { ru: 'Слова-триггеры', en: 'Trigger words' }
    };

    const titleMap = {
        CREATE: { ru: 'Создано правило авто-модерации', en: 'Auto-moderation rule created' },
        UPDATE: { ru: 'Обновлено правило авто-модерации', en: 'Auto-moderation rule updated' },
        DELETE: { ru: 'Удалено правило авто-модерации', en: 'Auto-moderation rule deleted' }
    };

    const t = lang === 'ru' ? 'ru' : 'en';
    const L = {
        name: lang === 'ru' ? 'Название' : 'Name',
        id: lang === 'ru' ? 'ID' : 'ID',
        executor: lang === 'ru' ? 'Исполнитель' : 'Executor',
        type: lang === 'ru' ? 'Тип' : 'Type',
        enabled: lang === 'ru' ? 'Включено' : 'Enabled',
        yes: lang === 'ru' ? 'Да' : 'Yes',
        no: lang === 'ru' ? 'Нет' : 'No',
        keywords: lang === 'ru' ? 'Ключевые слова' : 'Keywords',
        presets: lang === 'ru' ? 'Предустановленные триггеры' : 'Preset triggers',
        allowList: lang === 'ru' ? 'Разрешенные слова' : 'Allowed words',
        actions: lang === 'ru' ? 'Действия' : 'Actions',
        exemptRoles: lang === 'ru' ? 'Исключенные роли' : 'Exempt roles',
        exemptChannels: lang === 'ru' ? 'Исключенные каналы' : 'Exempt channels',
        changes: lang === 'ru' ? 'Изменения' : 'Changes',
        deleteMsg: lang === 'ru' ? 'Удалять сообщение' : 'Delete message',
        sendAlert: lang === 'ru' ? 'Отправлять уведомление' : 'Send alert',
        timeout: lang === 'ru' ? 'Временный бан' : 'Timeout',
        automod: lang === 'ru' ? 'Автомодерация' : 'Auto-moderation'
    };

    const ser = serializeRule(rule);

    const fields = [
        { name: L.name, value: ser.name || '—', inline: true },
        { name: L.id, value: `\`${ser.id}\``, inline: true },
        { name: L.executor, value: executor, inline: false },
        { name: L.type, value: (triggerMap[ser.triggerType] ? triggerMap[ser.triggerType][t] : ser.triggerType), inline: true },
        { name: L.enabled, value: ser.enabled ? L.yes : L.no, inline: true }
    ];

    if (ser.triggerMetadata.keywordFilter?.length)
        fields.push({ name: L.keywords, value: ser.triggerMetadata.keywordFilter.join(', ') });

    if (ser.triggerMetadata.presets?.length)
        fields.push({ name: L.presets, value: ser.triggerMetadata.presets.join(', ') });

    if (ser.triggerMetadata.allowList?.length)
        fields.push({ name: L.allowList, value: ser.triggerMetadata.allowList.join(', ') });

    if (ser.actions.length) {
        const act = ser.actions.map(a => (
            a.type === 1 ? L.deleteMsg :
            a.type === 2 ? L.sendAlert :
            a.type === 3 ? L.timeout : `${a.type}`
        ));
        fields.push({ name: L.actions, value: act.join('\n') });
    }

    if (ser.exemptRoles.length)
        fields.push({ name: L.exemptRoles, value: ser.exemptRoles.map(r => `<@&${r}>`).join(', ') });

    if (ser.exemptChannels.length)
        fields.push({ name: L.exemptChannels, value: ser.exemptChannels.map(c => `<#${c}>`).join(', ') });

    if (action === 'UPDATE' && oldRule) {
        const changes = [];
        if (oldRule.name !== ser.name) changes.push(`${L.name}: \`${oldRule.name}\` → \`${ser.name}\``);
        if (oldRule.enabled !== ser.enabled) changes.push(`${L.enabled}: \`${oldRule.enabled ? L.yes : L.no}\` → \`${ser.enabled ? L.yes : L.no}\``);
        if (changes.length) fields.push({ name: L.changes, value: changes.join('\n') });
    }

    const embed = new EmbedBuilder()
        .setColor('#fe983e')
        .setTitle(titleMap[action][t])
        .addFields(fields)
        .setFooter({ text: `ID сервера: ${guild.id} | ${formatTime()}` });

    await sendAutomodAndSoundLogEmbed(guild, embed, L.automod);
}

client.on(Events.AutoModerationActionExecution, async (execution) => {
    try {
        const guild = execution.guild;
        if (!guild) return;

        incrementLogCount();

        const lang = await getGuildLang(guild.id);

        const user = execution.user || await guild.members.fetch(execution.userId).then(m => m.user).catch(() => null);
        const channel = execution.channel || (execution.channelId ? guild.channels.cache.get(execution.channelId) : null);

        let ruleName = '—';
        try {
            const rule = await guild.autoModerationRules.fetch(execution.ruleId);
            if (rule?.name) ruleName = rule.name;
        } catch {}

        const t = lang === 'ru' ? 'ru' : 'en';

        const actionType =
            execution.action?.type === AutoModerationActionType.BlockMessage ? (t === 'ru' ? 'Блокировка сообщения' : 'Block message') :
            execution.action?.type === AutoModerationActionType.SendAlertMessage ? (t === 'ru' ? 'Оповещение модераторов' : 'Send alert') :
            execution.action?.type === AutoModerationActionType.Timeout ? (t === 'ru' ? 'Тайм-аут' : 'Timeout') :
            `${execution.action?.type ?? '—'}`;

        const title = t === 'ru' ? 'Сработало правило авто-модерации' : 'Auto-moderation rule triggered';

        const fields = [];

        fields.push({
            name: t === 'ru' ? 'Пользователь' : 'User',
            value: user ? `\`${user.tag}\` (<@${user.id}>)` : (t === 'ru' ? 'Неизвестно' : 'Unknown'),
            inline: false
        });

        fields.push({
            name: t === 'ru' ? 'Правило' : 'Rule',
            value: `\`${ruleName}\` (\`${execution.ruleId}\`)`,
            inline: false
        });

        fields.push({
            name: t === 'ru' ? 'Действие' : 'Action',
            value: actionType,
            inline: true
        });

        if (channel) {
            fields.push({
                name: t === 'ru' ? 'Канал' : 'Channel',
                value: `${channel.name ? `\`${channel.name}\`` : ''} (<#${channel.id}>)`,
                inline: true
            });
        }

        if (execution.matchedKeyword) {
            fields.push({
                name: t === 'ru' ? 'Совпавшее слово' : 'Matched keyword',
                value: `\`${execution.matchedKeyword}\``,
                inline: false
            });
        }

        if (execution.matchedContent) {
            const content = execution.matchedContent.length > 1024
                ? execution.matchedContent.slice(0, 1020) + ' ...'
                : execution.matchedContent;

            fields.push({
                name: t === 'ru' ? 'Фрагмент сообщения' : 'Matched content',
                value: content,
                inline: false
            });
        }

        const embed = new EmbedBuilder()
            .setColor('#fe983e')
            .setTitle(title)
            .addFields(fields)
            .setFooter({ text: `${t === 'ru' ? 'ID сервера' : 'Server ID'}: ${guild.id} | ${formatTime()}` });

        await sendAutomodAndSoundLogEmbed(guild, embed, t === 'ru' ? 'Автомодерация' : 'Auto-moderation');
    } catch (err) {
        console.error('Ошибка при обработке AutoModerationActionExecution:', err);
    }
});

async function handleSoundboardEntry(guild, entry) {
    const lang = await getGuildLang(guild.id);

    const executor = entry.executor ? `<@${entry.executor.id}>` : (lang === 'ru' ? 'Неизвестно' : 'Unknown');

    const action =
        entry.actionType === AuditLogEvent.SoundboardSoundCreate ? 'CREATE' :
        entry.actionType === AuditLogEvent.SoundboardSoundUpdate ? 'UPDATE' : 'DELETE';

    const target = entry.target || {};
    const changes = entry.changes || [];

    const getChange = key => changes.find(c => c.key === key)?.new ?? changes.find(c => c.key === key)?.old ?? null;

    const name = action === 'DELETE' ? `~~${getChange('name') || target.name || '—'}~~` : (target.name || getChange('name') || '—');
    const soundId = target.sound_id || getChange('sound_id') || '—';

    const embed = new EmbedBuilder()
        .setColor('#fe983e')
        .setTitle(action === 'CREATE' ? 'Создан звук' : action === 'UPDATE' ? 'Обновлён звук' : 'Удалён звук')
        .addFields(
            { name: 'Имя трека', value: name, inline: true },
            { name: 'ID трека', value: `\`${soundId}\``, inline: true },
            { name: 'Пользователь', value: executor, inline: false }
        )
        .setFooter({ text: `ID сервера: ${guild.id} | ${formatTime()}` });

    await sendAutomodAndSoundLogEmbed(guild, embed, 'Сервер');
}


// Роли
async function sendLogEmbed(guild, embed, category) {
    dbLogs.get(`SELECT channelID FROM logs_settings WHERE guildID = ?`, [guild.id], async (err, row) => {
        if (!err && row?.channelID) {
            const channel = guild.channels.cache.get(row.channelID);
            if (channel?.isTextBased()) return channel.send({ embeds: [embed] }).catch(console.error);
        }

        dbSettings.get(`
            SELECT channel_id, enabled, mode, webhook_url
            FROM logs
            WHERE server_id = ? AND category = ?
        `, [guild.id, category], (err2, row2) => {
            if (err2 || !row2?.enabled || !row2.channel_id) return;
        
            if (row2.mode === 'webhook' && isValidWebhookUrl(row2.webhook_url)) {
                try {
                    const webhook = new WebhookClient({ url: row2.webhook_url });
                    webhook.send({ embeds: [embed] }).catch(console.error);
                } catch (err) {
                    if (err?.code !== 'WebhookURLInvalid') console.error('Ошибка при отправке через вебхук:', err);
                }
            } else {
                const extraChannel = guild.channels.cache.get(row2.channel_id);
                if (extraChannel?.isTextBased()) {
                    extraChannel.send({ embeds: [embed] }).catch(console.error);
                }
            }
        });
    });
}

client.on('roleCreate', async (role) => {
    const lang = await getGuildLang(role.guild.id);
    let executorTag = lang === 'ru' ? 'Неизвестно' : 'Unknown';

    try {
        const auditLogs = await role.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.RoleCreate });
        const entry = auditLogs.entries.first();
        if (entry) executorTag = `\`${entry.executor.tag}\` (<@${entry.executor.id}>)`;
    } catch { }

    const embed = new EmbedBuilder()
        .setColor('#fe983e')
        .setTitle(lang === 'ru' ? 'Новая роль' : 'New Role')
        .setThumbnail(role.guild.iconURL({ dynamic: true, size: 256 }) || 'https://discord.com/assets/411d8a698dd15ddf.png')
        .addFields(
            { name: lang === 'ru' ? 'Имя роли' : 'Role Name', value: `\`${role.name || '-'}\``, inline: true },
            { name: lang === 'ru' ? 'ID роли' : 'Role ID', value: role.id, inline: true },
            { name: lang === 'ru' ? 'Автор' : 'Creator', value: executorTag, inline: false }
        )
        .setFooter({ text: `${lang === 'ru' ? 'ID сервера' : 'Server ID'}: ${role.guild.id} | ${formatTime()}` });

    await sendLogEmbed(role.guild, embed, 'Роли');
});

function createRoleCircleBuffer(roleColor) {
    const size = 256;
    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext('2d');

    ctx.clearRect(0, 0, size, size);

    const radius = 100;

    ctx.beginPath();
    ctx.moveTo(radius, 0);
    ctx.lineTo(size - radius, 0);
    ctx.quadraticCurveTo(size, 0, size, radius);
    ctx.lineTo(size, size - radius);
    ctx.quadraticCurveTo(size, size, size - radius, size);
    ctx.lineTo(radius, size);
    ctx.quadraticCurveTo(0, size, 0, size - radius);
    ctx.lineTo(0, radius);
    ctx.quadraticCurveTo(0, 0, radius, 0);
    ctx.closePath();

    let baseColor;

    if (Array.isArray(roleColor)) {
        baseColor = roleColor[0];
    } else {
        baseColor = roleColor;
    }

    ctx.fillStyle =
        baseColor === '#000000'
            ? 'rgba(47,49,54,0.5)'
            : baseColor + '80';

    ctx.fill();

    const circleRadius = size / 2 - 50;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, circleRadius, 0, Math.PI * 2);
    ctx.closePath();

    if (Array.isArray(roleColor)) {
        const gradient = ctx.createLinearGradient(0, 0, size, size);
        roleColor.forEach((c, i) => {
            gradient.addColorStop(i / (roleColor.length - 1), c);
        });
        ctx.fillStyle = gradient;
    } else {
        ctx.fillStyle =
            roleColor === '#000000'
                ? '#2f3136'
                : roleColor;
    }

    ctx.fill();

    return canvas.toBuffer();
}

function formatRoleColor(role) {
    const c = role.colors;

    if (c.secondaryColor != null || c.tertiaryColor != null) {
        const arr = [];
        if (c.primaryColor != null) arr.push(`#${c.primaryColor.toString(16).padStart(6, '0')}`);
        if (c.secondaryColor != null) arr.push(`#${c.secondaryColor.toString(16).padStart(6, '0')}`);
        if (c.tertiaryColor != null) arr.push(`#${c.tertiaryColor.toString(16).padStart(6, '0')}`);
        return arr.join(' + ');
    }

    return role.hexColor;
}

client.on('roleUpdate', async (oldRole, newRole) => {
    const lang = await getGuildLang(newRole.guild.id);
    let editor;

    if (newRole.guild.members.me.permissions.has('ViewAuditLog')) {
        try {
            const logs = await newRole.guild.fetchAuditLogs({
                type: AuditLogEvent.RoleUpdate,
                limit: 1
            });
            const entry = logs.entries.first();
            if (entry?.executor) {
                editor = `\`${entry.executor.tag}\` (<@${entry.executor.id}>)`;
            }
        } catch {}
    }

    const changes = [];

    if (oldRole.name !== newRole.name) {
        changes.push({
            name: lang === 'ru' ? 'Имя' : 'Name',
            value: `\`${oldRole.name}\` → \`${newRole.name}\``,
            inline: true
        });
    }

    const colorChanged =
        oldRole.colors.primaryColor !== newRole.colors.primaryColor ||
        oldRole.colors.secondaryColor !== newRole.colors.secondaryColor ||
        oldRole.colors.tertiaryColor !== newRole.colors.tertiaryColor;

    let previewColorChanged = false;

    if (colorChanged) {
        previewColorChanged = true;
    
        changes.push({
            name: lang === 'ru' ? 'Цвет' : 'Color',
            value: `${lang === 'ru' ? 'Было' : 'Old'} \`${formatRoleColor(oldRole)}\`\n${lang === 'ru' ? 'Стало' : 'New'} \`${formatRoleColor(newRole)}\``,
            inline: true
        });
    
        changes.push({
            name: lang === 'ru' ? 'Тип' : 'Type',
            value: getRoleColorType(newRole, lang),
            inline: true
        });
    }
    

    if (oldRole.hoist !== newRole.hoist) {
        changes.push({
            name: lang === 'ru' ? 'Отображать отдельно' : 'Hoist',
            value: `\`${oldRole.hoist}\` → \`${newRole.hoist}\``,
            inline: true
        });
    }

    if (oldRole.mentionable !== newRole.mentionable) {
        changes.push({
            name: lang === 'ru' ? 'Можно упоминать' : 'Mentionable',
            value: `\`${oldRole.mentionable}\` → \`${newRole.mentionable}\``,
            inline: true
        });
    }

    const oldIcon = oldRole.iconURL({ dynamic: true, size: 256 });
    const newIcon = newRole.iconURL({ dynamic: true, size: 256 });
    
    if (oldIcon !== newIcon) {
        changes.push({
            name: lang === 'ru' ? 'Иконка' : 'Icon',
            value:
                `${oldIcon ? `[${lang === 'ru' ? 'Старая' : 'Old'}](${oldIcon})` : (lang === 'ru' ? 'Старая: нет' : 'Old: none')}` +
                ` → ` +
                `${newIcon ? `[${lang === 'ru' ? 'Новая' : 'New'}](${newIcon})` : (lang === 'ru' ? 'Новая: нет' : 'New: none')}`,
            inline: true
        });
    }

    const oldPerms = oldRole.permissions.toArray();
    const newPerms = newRole.permissions.toArray();
    
    const added = newPerms.filter(p => !oldPerms.includes(p));
    const removed = oldPerms.filter(p => !newPerms.includes(p));
    
    if (added.length || removed.length) {
        changes.push({
            name: lang === 'ru' ? 'Разрешения' : 'Permissions',
            value:
                (added.length ? `\`+\` ${added.join(', ')}\n` : '') +
                (removed.length ? `\`-\` ${removed.join(', ')}` : ''),
            inline: false
        });
    }

    if (!changes.length) return;

    let thumbnail = newRole.iconURL({ dynamic: true, size: 256 }) 
        || newRole.guild.iconURL({ dynamic: true, size: 256 });

    if (previewColorChanged) {
        const c = newRole.colors;
        let colorInput;

        if (c.secondaryColor != null || c.tertiaryColor != null) {
            colorInput = [];
            if (c.primaryColor != null) colorInput.push(`#${c.primaryColor.toString(16).padStart(6, '0')}`);
            if (c.secondaryColor != null) colorInput.push(`#${c.secondaryColor.toString(16).padStart(6, '0')}`);
            if (c.tertiaryColor != null) colorInput.push(`#${c.tertiaryColor.toString(16).padStart(6, '0')}`);
        } else {
            colorInput = newRole.hexColor;
        }

        const buffer = createRoleCircleBuffer(colorInput);

        const tempChannel = await client.channels.fetch('1449285462769537256');
        if (tempChannel?.isTextBased()) {
            const attachment = new AttachmentBuilder(buffer, { name: 'role.png' });
            const msg = await tempChannel.send({ files: [attachment] });
            const img = msg.attachments.first();
            if (img?.url) {
                thumbnail = img.url;
            }
        }
    }

    const embed = new EmbedBuilder()
        .setColor('#fe983e')
        .setTitle(lang === 'ru' ? 'Обновление роли' : 'Role Updated')
        .setThumbnail(thumbnail)
        .addFields(
            { name: lang === 'ru' ? 'Роль' : 'Role', value: newRole.name, inline: true },
            { name: lang === 'ru' ? 'ID роли' : 'Role ID', value: `\`${newRole.id}\``, inline: true },
            { name: '\u200B', value: '\u200B', inline: true },
            ...changes,
            ...(editor
                ? [{ name: lang === 'ru' ? 'Изменил' : 'Edited by', value: editor }]
                : [])
        )
        .setFooter({
            text: `${lang === 'ru' ? 'ID сервера' : 'Server ID'}: ${newRole.guild.id} | ${formatTime()}`
        });

    await sendLogEmbed(newRole.guild, embed, 'Роли', []);
});

function getRoleColorType(role, lang) {
    const c = role.colors;

    if (c.tertiaryColor) return lang === 'ru' ? 'Голографический' : 'Holographic';
    if (c.secondaryColor) return lang === 'ru' ? 'Градиент' : 'Gradient';
    return lang === 'ru' ? 'Обычный' : 'Single';
}

client.on('roleDelete', async (role) => {
    const lang = await getGuildLang(role.guild.id);
    let deleter;

    if (role.guild.members.me.permissions.has('ViewAuditLog')) {
        try {
            const logs = await role.guild.fetchAuditLogs({ type: AuditLogEvent.RoleDelete, limit: 1 });
            const entry = logs.entries.first();
            if (entry?.executor) deleter = `\`${entry.executor.tag}\` (<@${entry.executor.id}>)`;
        } catch { }
    }

    const embed = new EmbedBuilder()
        .setColor('#fe983e')
        .setTitle(lang === 'ru' ? 'Удаление роли' : 'Role Deleted')
        .setThumbnail(role.guild.iconURL({ dynamic: true, size: 256 }) || 'https://discord.com/assets/411d8a698dd15ddf.png')
        .addFields(
            { name: lang === 'ru' ? 'Имя роли' : 'Role Name', value: role.name || '-', inline: true },
            { name: lang === 'ru' ? 'ID роли' : 'Role ID', value: role.id, inline: true },
            ...(deleter ? [{ name: lang === 'ru' ? 'Удалил' : 'Deleted by', value: deleter, inline: false }] : [])
        )
        .setFooter({ text: `${lang === 'ru' ? 'ID сервера' : 'Server ID'}: ${role.guild.id} | ${formatTime()}` });

    await sendLogEmbed(role.guild, embed, 'Роли');
});

client.on('guildMemberUpdate', async (oldMember, newMember) => {
    if (newMember.user.bot) return;

    if (!oldMember.roles.cache.size) return;

    const addedRoles = newMember.roles.cache.filter(r => !oldMember.roles.cache.has(r.id));
    const removedRoles = oldMember.roles.cache.filter(r => !newMember.roles.cache.has(r.id));

    if (!addedRoles.size && !removedRoles.size) return;

    if (
        addedRoles.size === newMember.roles.cache.size ||
        removedRoles.size === oldMember.roles.cache.size
    ) return;

    let entry;
    try {
        const logs = await newMember.guild.fetchAuditLogs({
            limit: 1,
            type: AuditLogEvent.MemberRoleUpdate
        });

        entry = logs.entries.first();

        if (
            !entry ||
            entry.target.id !== newMember.id ||
            Date.now() - entry.createdTimestamp > 5000
        ) return;

    } catch (err) {
        console.error('Ошибка получения аудит-лога ролей');
        return;
    }

    const lang = await getGuildLang(newMember.guild.id);

    const embed = new EmbedBuilder()
        .setColor('#fe983e')
        .setThumbnail(newMember.user.displayAvatarURL({ dynamic: true, size: 256 }))
        .setTitle(lang === 'ru' ? 'Изменения ролей' : 'Role Changes')
        .addFields({
            name: lang === 'ru' ? 'Участник' : 'Member',
            value: `\`${newMember.user.tag}\` (<@${newMember.id}>)`
        });

        if (addedRoles.size) {
            embed.addFields({
                name: lang === 'ru' ? 'Добавлены роли' : 'Roles Added',
                value: addedRoles.map(r => `\`${r.name}\` <@&${r.id}>`).join('\n')
            });
        }
    
        if (removedRoles.size) {
            embed.addFields({
                name: lang === 'ru' ? 'Удалены роли' : 'Roles Removed',
                value: removedRoles.map(r => `\`${r.name}\` <@&${r.id}>`).join('\n')
            });
        }

    embed.addFields({
        name: lang === 'ru' ? 'Кто изменил' : 'Modified By',
        value: `\`${entry.executor.tag}\` (<@${entry.executor.id}>)`
    });

    await sendLogEmbed(newMember.guild, embed, 'Роли');
});

// гуилд изменения
async function sendServerLogEmbed(guild, embed) {
    dbLogs.get(`SELECT channelID FROM logs_settings WHERE guildID = ?`, [guild.id], async (err, row) => {
        if (!err && row?.channelID) {
            const channel = guild.channels.cache.get(row.channelID);
            if (channel?.isTextBased()) return channel.send({ embeds: [embed] }).catch(console.error);
        }

        dbSettings.get(`
            SELECT channel_id, enabled, mode, webhook_url
            FROM logs
            WHERE server_id = ? AND category = 'Сервер'
        `, [guild.id], (err2, row2) => {
            if (err2 || !row2?.enabled || !row2.channel_id) return;
        
            if (row2.mode === 'webhook' && isValidWebhookUrl(row2.webhook_url)) {
                try {
                    const webhook = new WebhookClient({ url: row2.webhook_url });
                    webhook.send({ embeds: [embed] }).catch(console.error);
                } catch (err) {
                    if (err?.code !== 'WebhookURLInvalid') console.error('Ошибка при отправке через вебхук:', err);
                }
            } else {
                const extraChannel = guild.channels.cache.get(row2.channel_id);
                if (extraChannel?.isTextBased()) {
                    extraChannel.send({ embeds: [embed] }).catch(console.error);
                }
            }
        });
    });
}

async function sendServerComponentsLog(guild, components) {
    dbLogs.get(`SELECT channelID FROM logs_settings WHERE guildID = ?`, [guild.id], async (err, row) => {
        if (!err && row?.channelID) {
            const channel = guild.channels.cache.get(row.channelID);
            if (channel?.isTextBased()) {
                return channel.send({
                    components,
                    flags: MessageFlags.IsComponentsV2
                }).catch(console.error);
            }
        }

        dbSettings.get(`
            SELECT channel_id, enabled, mode, webhook_url
            FROM logs
            WHERE server_id = ? AND category = 'Сервер'
        `, [guild.id], (err2, row2) => {
            if (err2 || !row2?.enabled || !row2.channel_id) return;

            if (row2.mode === 'webhook' && isValidWebhookUrl(row2.webhook_url)) {
                try {
                    const webhook = new WebhookClient({ url: row2.webhook_url });
                    webhook.send({
                        components,
                        flags: MessageFlags.IsComponentsV2
                    }).catch(console.error);
                } catch (err) {
                    if (err?.code !== 'WebhookURLInvalid') console.error('Ошибка при отправке через вебхук:', err);
                }
            } else {
                const extraChannel = guild.channels.cache.get(row2.channel_id);
                if (extraChannel?.isTextBased()) {
                    extraChannel.send({
                        components,
                        flags: MessageFlags.IsComponentsV2
                    }).catch(console.error);
                }
            }
        });
    });
}

client.on('guildUpdate', async (oldGuild, newGuild) => {
    try {
        incrementLogCount();

        const lang = await getGuildLang(newGuild.id);
        const fields = [];

        const t = {
            serverUpdated: lang === 'ru' ? 'Обновление сервера' : 'Server updated',
            serverName: lang === 'ru' ? 'Имя сервера' : 'Server name',
            icon: lang === 'ru' ? 'Иконка' : 'Icon',
            description: lang === 'ru' ? 'Описание' : 'Description',
            owner: lang === 'ru' ? 'Владелец' : 'Owner',
            verification: lang === 'ru' ? 'Уровень модерации' : 'Moderation level',
            nsfw: lang === 'ru' ? 'Уровень NSFW' : 'NSFW level',
            language: lang === 'ru' ? 'Язык сервера' : 'Server language',
            afkTimeout: lang === 'ru' ? 'AFK таймаут' : 'AFK timeout',
            afkChannel: lang === 'ru' ? 'AFK канал' : 'AFK channel',
            systemChannel: lang === 'ru' ? 'Системный канал' : 'System channel',
            rulesChannel: lang === 'ru' ? 'Канал правил' : 'Rules channel',
            community: 'Community',
            banner: lang === 'ru' ? 'Баннер' : 'Banner',
            enabled: lang === 'ru' ? 'включено' : 'enabled',
            disabled: lang === 'ru' ? 'выключено' : 'disabled',
            none: 'none'
        };

        const formatValue = (v) => {
            if (v === null || v === undefined || v === '') return t.none;
            if (typeof v === 'boolean') return v ? t.enabled : t.disabled;
            return String(v);
        };

        const diff = (before, after) =>
            `- ${lang === 'ru' ? 'Было' : 'Before'}: \`${formatValue(before)}\`\n` +
            `- ${lang === 'ru' ? 'Стало' : 'After'}: \`${formatValue(after)}\``;

        const add = (name, value) => {
            fields.push({ name, value, inline: false });
        };

        const iconChanged = oldGuild.icon !== newGuild.icon;
        const bannerChanged = oldGuild.banner !== newGuild.banner;

        const oldDesc = oldGuild.description || null;
        const newDesc = newGuild.description || null;
        if (oldDesc !== newDesc) add(t.description, diff(oldDesc, newDesc));

        const oldCommunity = oldGuild.features.includes('COMMUNITY');
        const newCommunity = newGuild.features.includes('COMMUNITY');

        const formatChannel = (guild, channelId) => {
            if (!channelId) return t.none;
            const channel = guild.channels.cache.get(channelId);
            return channel ? `\`${channel.name}\` <#${channelId}>` : t.none;
        };

        if (oldGuild.name !== newGuild.name) add(t.serverName, diff(oldGuild.name, newGuild.name));
        if (oldGuild.ownerId !== newGuild.ownerId) add(t.owner, diff(`<@${oldGuild.ownerId}>`, `<@${newGuild.ownerId}>`));

        if (oldGuild.verificationLevel !== newGuild.verificationLevel) add(t.verification, diff(formatVerificationLevel(oldGuild.verificationLevel, lang), formatVerificationLevel(newGuild.verificationLevel, lang)));
        if (oldGuild.nsfwLevel !== newGuild.nsfwLevel) add(t.nsfw, diff(oldGuild.nsfwLevel, newGuild.nsfwLevel));
        if (oldGuild.preferredLocale !== newGuild.preferredLocale) add(t.language, diff(oldGuild.preferredLocale, newGuild.preferredLocale));
        if (oldGuild.afkTimeout !== newGuild.afkTimeout) add(t.afkTimeout, diff(oldGuild.afkTimeout, newGuild.afkTimeout));
        if (oldGuild.afkChannelId !== newGuild.afkChannelId) add(t.afkChannel, diff(formatChannel(oldGuild, oldGuild.afkChannelId), formatChannel(newGuild, newGuild.afkChannelId)));
        if (oldGuild.systemChannelId !== newGuild.systemChannelId) add(t.systemChannel, diff(formatChannel(oldGuild, oldGuild.systemChannelId), formatChannel(newGuild, newGuild.systemChannelId)));
        if (oldGuild.rulesChannelId !== newGuild.rulesChannelId) add(t.rulesChannel, diff(formatChannel(oldGuild, oldGuild.rulesChannelId), formatChannel(newGuild, newGuild.rulesChannelId)));
        if (oldCommunity !== newCommunity) add(t.community, diff(oldCommunity ? t.enabled : t.disabled, newCommunity ? t.enabled : t.disabled));
        if (oldGuild.banner !== newGuild.banner) {
        }

        if (fields.length) {
            const embed = new EmbedBuilder()
                .setColor('#fe983e')
                .setTitle(t.serverUpdated)
                .setThumbnail(newGuild.iconURL({ dynamic: true, size: 256 }))
                .addFields(fields)
                .setFooter({ text: `ID: ${newGuild.id} | ${formatTime()}` });

            await sendServerLogEmbed(newGuild, embed);
        }

        const buildImageChangeComponents = (title, labelOld, labelNew, oldUrl, newUrl) => {
            const components = [];

            const container = new ContainerBuilder().setAccentColor(16685118);

            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(title)
            );

            if (oldUrl) {
                container.addSectionComponents(
                    new SectionBuilder()
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(`${labelOld}:`)
                        )
                        .setThumbnailAccessory(
                            new ThumbnailBuilder()
                                .setURL(oldUrl)
                                .setDescription(labelOld)
                        )
                );
            } else {
                container.addSectionComponents(
                    new SectionBuilder().addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(`${labelOld}: ${t.none}`)
                    )
                );
            }

            container.addSeparatorComponents(
                new SeparatorBuilder()
                    .setSpacing(SeparatorSpacingSize.Small)
                    .setDivider(true)
            );

            if (newUrl) {
                container.addSectionComponents(
                    new SectionBuilder()
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(`${labelNew}:`)
                        )
                        .setThumbnailAccessory(
                            new ThumbnailBuilder()
                                .setURL(newUrl)
                                .setDescription(labelNew)
                        )
                );
            } else {
                container.addSectionComponents(
                    new SectionBuilder().addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(`${labelNew}: ${t.none}`)
                    )
                );
            }

            components.push(container);

            return components;
        };

        if (iconChanged) {
            const oldIconUrl = oldGuild.iconURL({ size: 512 });
            const newIconUrl = newGuild.iconURL({ size: 512 });
            if (oldIconUrl || newIconUrl) {
                const title = lang === 'ru' ? '### Аватар сервера изменён' : '### Server icon changed';
                const labelOld = lang === 'ru' ? 'Старый аватар' : 'Old icon';
                const labelNew = lang === 'ru' ? 'Новый аватар' : 'New icon';
                const components = buildImageChangeComponents(title, labelOld, labelNew, oldIconUrl, newIconUrl);
                await sendServerComponentsLog(newGuild, components);
            }
        }

        if (bannerChanged) {
            const oldBannerUrl = oldGuild.bannerURL({ size: 512 });
            const newBannerUrl = newGuild.bannerURL({ size: 512 });
            if (oldBannerUrl || newBannerUrl) {
                const title = lang === 'ru' ? '### Баннер сервера изменён' : '### Server banner changed';
                const labelOld = lang === 'ru' ? 'Старый баннер' : 'Old banner';
                const labelNew = lang === 'ru' ? 'Новый баннер' : 'New banner';
                const components = buildImageChangeComponents(title, labelOld, labelNew, oldBannerUrl, newBannerUrl);
                await sendServerComponentsLog(newGuild, components);
            }
        }

    } catch (e) {
        console.error('guildUpdate error', e);
    }
});

// бусты

client.on('guildMemberUpdate', async (oldMember, newMember) => {
    const lang = await getGuildLang(newMember.guild.id);

    if (!oldMember.premiumSince && newMember.premiumSince) {

        const embed = new EmbedBuilder()
            .setColor('#ff73fa')
            .setThumbnail(newMember.user.displayAvatarURL({ dynamic: true }))
            .setTitle(lang === 'ru' ? 'Новый буст' : 'Server Boost')
            .addFields(
                {
                    name: lang === 'ru' ? 'Пользователь' : 'User',
                    value: `\`${newMember.user.tag}\` (<@${newMember.id}>)`
                },
                {
                    name: lang === 'ru' ? 'Количество бустов' : 'Boosts',
                    value: `${newMember.guild.premiumSubscriptionCount}`
                }
            )
            .setFooter({
                text: `ID: ${newMember.id} | ${formatTime()}`
            });

        await sendServerLogEmbed(newMember.guild, embed);
    }

    if (oldMember.premiumSince && !newMember.premiumSince) {

        const embed = new EmbedBuilder()
            .setColor('#ff73fa')
            .setTitle(lang === 'ru' ? 'Буст удалён' : 'Boost Removed')
            .addFields({
                name: lang === 'ru' ? 'Пользователь' : 'User',
                value: `\`${newMember.user.tag}\` (<@${newMember.id}>)`
            })
            .setFooter({
                text: `ID: ${newMember.id} | ${formatTime()}`
            });

        await sendServerLogEmbed(newMember.guild, embed);
    }
});

client.on('userUpdate', async (oldUser, newUser) => {
    if (newUser.bot) return;

    if (
        oldUser.avatar === newUser.avatar &&
        oldUser.avatarDecoration !== newUser.avatarDecoration
    ) return;

    if (oldUser.avatar === newUser.avatar) return;

    const oldAvatarUrl = oldUser.avatar
        ? `https://cdn.discordapp.com/avatars/${newUser.id}/${oldUser.avatar}.png?size=512`
        : null;

    const newAvatarUrl = newUser.avatar
        ? `https://cdn.discordapp.com/avatars/${newUser.id}/${newUser.avatar}.png?size=512`
        : null;

    for (const guild of client.guilds.cache.values()) {
        let member;

        try {
            member = await guild.members.fetch(newUser.id);
        } catch {
            continue;
        }

        if (!member) continue;

        const lang = await getGuildLang(guild.id);
        incrementLogCount();

        const t = {
            title: lang === 'ru'
                ? '### Аватар изменён'
                : '### Avatar changed',
            old: lang === 'ru'
                ? 'Старый аватар'
                : 'Old avatar',
            new: lang === 'ru'
                ? 'Новый аватар'
                : 'New avatar'
        };

        const container = new ContainerBuilder()
            .setAccentColor(16685118);

        container.addTextDisplayComponents(
            new TextDisplayBuilder()
                .setContent(`${t.title}\n<@${newUser.id}> `)
        );

        if (oldAvatarUrl) {
            container.addSectionComponents(
                new SectionBuilder()
                    .addTextDisplayComponents(
                        new TextDisplayBuilder()
                            .setContent(`${t.old}:`)
                    )
                    .setThumbnailAccessory(
                        new ThumbnailBuilder()
                            .setURL(oldAvatarUrl)
                    )
            );
        }

        container.addSeparatorComponents(
            new SeparatorBuilder()
                .setDivider(true)
        );

        if (newAvatarUrl) {
            container.addSectionComponents(
                new SectionBuilder()
                    .addTextDisplayComponents(
                        new TextDisplayBuilder()
                            .setContent(`${t.new}:`)
                    )
                    .setThumbnailAccessory(
                        new ThumbnailBuilder()
                            .setURL(newAvatarUrl)
                    )
            );
        }

        sendLog(guild, {
            components: [container],
            allowedMentions: {
                parse: [] 
            },
            flags: 4096
        });
    }
});

client.on('guildMemberUpdate', async (oldMember, newMember) => {
    if (newMember.user.bot) return;


    if (
        oldMember.avatar === newMember.avatar &&
        oldMember.avatarDecoration !== newMember.avatarDecoration
    ) return;


    if (oldMember.avatar === newMember.avatar) return;

    const oldAvatarUrl = oldMember.avatar
        ? `https://cdn.discordapp.com/guilds/${newMember.guild.id}/users/${newMember.id}/avatars/${oldMember.avatar}.png?size=512`
        : null;

    const newAvatarUrl = newMember.avatar
        ? `https://cdn.discordapp.com/guilds/${newMember.guild.id}/users/${newMember.id}/avatars/${newMember.avatar}.png?size=512`
        : null;

    const lang = await getGuildLang(newMember.guild.id);
    incrementLogCount();

    const t = {
        title: lang === 'ru'
            ? '### Серверный аватар изменён'
            : '### Server avatar changed',
        old: lang === 'ru'
            ? 'Старый аватар'
            : 'Old avatar',
        new: lang === 'ru'
            ? 'Новый аватар'
            : 'New avatar'
    };

    const container = new ContainerBuilder()
        .setAccentColor(16685118);

    container.addTextDisplayComponents(
        new TextDisplayBuilder()
            .setContent(`${t.title}\n<@${newMember.id}>`)
    );

    if (oldAvatarUrl) {
        container.addSectionComponents(
            new SectionBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`${t.old}:`)
                )
                .setThumbnailAccessory(
                    new ThumbnailBuilder()
                        .setURL(oldAvatarUrl)
                )
        );
    }

    container.addSeparatorComponents(
        new SeparatorBuilder()
            .setDivider(true)
    );

    if (newAvatarUrl) {
        container.addSectionComponents(
            new SectionBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`${t.new}:`)
                )
                .setThumbnailAccessory(
                    new ThumbnailBuilder()
                        .setURL(newAvatarUrl)
                )
        );
    }

    sendLog(newMember.guild, {
        components: [container],
        allowedMentions: {
            parse: []
        },
        flags: 4096
    });
});


function sendLog(guild, payload) {
    if (payload.components) {
        payload.components = payload.components.map(c =>
            typeof c.toJSON === 'function'
                ? c.toJSON()
                : c
        );
    }

    payload.flags =
        (payload.flags || 0) |
        MessageFlags.IsComponentsV2;

    dbLogs.get(
        `SELECT channelID FROM logs_settings WHERE guildID = ?`,
        [guild.id],
        async (err, row) => {

        if (!err && row?.channelID) {
            const channel = guild.channels.cache.get(row.channelID);

            if (channel?.isTextBased()) {
                return channel.send(payload)
                    .catch(console.error);
            }
        }

        dbSettings.get(`
            SELECT channel_id, enabled, mode, webhook_url
            FROM logs
            WHERE server_id = ?
            AND category = 'Участники'
        `, [guild.id], (err2, row2) => {

            if (err2 || !row2?.enabled || !row2.channel_id) return;

            if (
                row2.mode === 'webhook' &&
                isValidWebhookUrl(row2.webhook_url)
            ) {
                const webhook = new WebhookClient({
                    url: row2.webhook_url
                });

                webhook.send(payload)
                    .catch(console.error);

            } else {
                const ch = guild.channels.cache.get(
                    row2.channel_id
                );

                if (ch?.isTextBased()) {
                    ch.send(payload)
                        .catch(console.error);
                }
            }
        });
    });
}

// сообщения
async function sendMessageEmbed(guild, embed, files = []) {
    dbLogs.get(`SELECT channelID FROM logs_settings WHERE guildID = ?`, [guild.id], async (err, row) => {
        if (!err && row?.channelID) {
            const channel = guild.channels.cache.get(row.channelID);
            if (channel?.isTextBased()) return channel.send({ embeds: [embed], files }).catch(console.error);
        }

        dbSettings.get(`
            SELECT channel_id, enabled, mode, webhook_url
            FROM logs
            WHERE server_id = ? AND category = 'Сообщения'
        `, [guild.id], (err2, row2) => {
            if (err2 || !row2?.enabled || !row2.channel_id) return;
        
            if (row2.mode === 'webhook' && isValidWebhookUrl(row2.webhook_url)) {
                try {
                    const webhook = new WebhookClient({ url: row2.webhook_url });
                    webhook.send({ embeds: [embed], files }).catch(console.error);
                } catch (err) {
                    if (err?.code !== 'WebhookURLInvalid') console.error('Ошибка при отправке через вебхук:', err);
                }
            } else {
                const extraChannel = guild.channels.cache.get(row2.channel_id);
                if (extraChannel?.isTextBased()) {
                    extraChannel.send({ embeds: [embed], files }).catch(console.error);
                }
            }
        });
    });
}


client.on('messageDelete', async (message) => {
    try {
        const storedMessage = getStoredMessageById(message?.id);

        if (message.partial) {
            try {
                await message.fetch();
            } catch {
            }
        }

        if (!message || !message.guild) return;
        if (message.author?.bot || (storedMessage && storedMessage.authorId === message.client?.user?.id)) return;

        const channelId = message.channel?.id || message.channelId;
        if (channelId && (await isChannelIgnored(message.guild.id, channelId))) return;

        incrementLogCount();
        const lang = await getGuildLang(message.guild.id);

        const createdDate = message.createdAt
            ? formatTime(message.createdAt, lang)
            : storedMessage?.createdAt
                ? formatTime(new Date(storedMessage.createdAt), lang)
                : (lang === 'ru' ? 'Неизвестно' : 'Unknown');

        let files = [];
        let textField = '';
        let attachmentField = '';
        let replyField = '';
        let extraDescription = '';
        let imageURL = null;
        let tempPaths = [];

        const baseContent = message.content || storedMessage?.content;

        if (baseContent) {
            if (baseContent.length > 500) {
                const folderPath = path.join(__dirname, 'messages');
                if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath);
                const filePath = path.join(folderPath, `delete_msg_${Date.now()}.txt`);
                const authorTagForFile = message.author?.tag || storedMessage?.authorTag || 'Unknown';
                fs.writeFileSync(filePath, `${authorTagForFile} • ${createdDate}\n\n${baseContent}`, 'utf8');
                files.push(new AttachmentBuilder(filePath));
                textField = lang === 'ru'
                    ? 'Сообщение превышает лимит в 500 символов, отправлено как файл.'
                    : 'Message exceeds 500 character limit, sent as a file.';
            } else {
                textField = baseContent;
            }
        }

        if (message.attachments.size > 0) {
            attachmentField = message.attachments.map(a => {
                if (!imageURL && a.contentType?.startsWith('image/')) imageURL = a.url;
                if (a.contentType?.startsWith('audio/')) return lang === 'ru' ? `Голосовое сообщение: [${a.name}](${a.url})` : `Voice message: [${a.name}](${a.url})`;
                return lang === 'ru' ? `Файл: [${a.name}](${a.url})` : `File: [${a.name}](${a.url})`;
            }).join('\n');
        }

        if (message.reference) {
            try {
                const refMsg = await message.channel.messages.fetch(message.reference.messageId);
                let replyContent = refMsg.content || (lang === 'ru' ? '[Без содержания]' : '[No content]');
                if (refMsg.attachments.size > 0 && !imageURL) {
                    for (const a of refMsg.attachments.values()) {
                        if (a.contentType?.startsWith('image/')) {
                            imageURL = a.url;
                            break;
                        }
                    }
                }
                if (refMsg.attachments.size > 0) {
                    replyContent += (replyContent ? '\n' : '') + (lang === 'ru'
                        ? `Вложение: ${refMsg.attachments.first().name}`
                        : `Attachment: ${refMsg.attachments.first().name}`);
                }
                replyField = `\`${refMsg.author.tag}\`:\n${replyContent}`;
            } catch {
                replyField = lang === 'ru' ? 'Содержимое не удалось получить' : 'Content could not be fetched';
            }
        }

        if (message.embeds.length > 0) {
            extraDescription += lang === 'ru' ? '\nУдалён эмбед ссылки:\n' : '\nEmbed link removed:\n';
        
            message.embeds.forEach((embed, index) => {
                let embedText = lang === 'ru' ? `Эмбед ${index + 1}:\n` : `Embed ${index + 1}:\n`;
        
                if (embed.title && embed.title.trim()) embedText += (lang === 'ru' ? `Заголовок: ${embed.title}\n` : `Title: ${embed.title}\n`);
                if (embed.description && embed.description.trim()) embedText += (lang === 'ru' ? `Описание: ${embed.description}\n` : `Description: ${embed.description}\n`);
                if (embed.footer?.text && embed.footer.text.trim()) embedText += (lang === 'ru' ? `Футер: ${embed.footer.text}\n` : `Footer: ${embed.footer.text}\n`);
                if (embed.hexColor) embedText += (lang === 'ru' ? `Цвет: ${embed.hexColor}\n` : `Color: ${embed.hexColor}\n`);
                
                if (embedText.trim() !== (lang === 'ru' ? `Эмбед ${index + 1}:` : `Embed ${index + 1}:`)) {
                    extraDescription += embedText + '\n';
                }
            });
        }        
        

        if (message.stickers.size > 0) {
            extraDescription += message.stickers.map(sticker =>
                lang === 'ru' ? `Удалён стикер: ${sticker.name}` : `Sticker removed: ${sticker.name}`
            ).join('\n');
        }

        if (!textField && !attachmentField && !replyField && !extraDescription) {
            extraDescription = lang === 'ru'
                ? 'Удалены другие данные (без текста, вложений, эмбедов или ссылок)'
                : 'Other data removed (no text, attachments, embeds, or links)';
        }

        const authorTag = message.author?.tag || storedMessage?.authorTag || (lang === 'ru' ? 'Неизвестный' : 'Unknown');
        const authorId = message.author?.id || storedMessage?.authorId || null;
        const authorValue = authorId
            ? `\`${authorTag}\` (<@${authorId}>)`
            : `\`${authorTag}\``;

        const deleteEmbed = new EmbedBuilder()
            .setColor('#fe983e')
            .setTitle(lang === 'ru' ? 'Сообщение удалено' : 'Message Deleted')
            .setThumbnail(
                message.author?.displayAvatarURL({ dynamic: true, size: 256 }) ||
                message.guild.iconURL({ dynamic: true, size: 256 }) ||
                'https://discord.com/assets/411d8a698dd15ddf.png'
            )
            .addFields(
                { name: lang === 'ru' ? 'Автор' : 'Author', value: authorValue, inline: true },
                { name: lang === 'ru' ? 'Отправлено' : 'Sent', value: `\`${createdDate}\``, inline: true },
                { name: '\u200B', value: '\u200B', inline: true },
                {
                    name: lang === 'ru' ? 'Канал' : 'Channel',
                    value: message.channel
                        ? `\`${message.channel.name}\` (<#${message.channel.id}>)`
                        : (lang === 'ru' ? 'Неизвестный канал' : 'Unknown channel'),
                    inline: true
                }
            );

        if (textField) deleteEmbed.addFields({ name: lang === 'ru' ? 'Текст' : 'Text', value: textField, inline: true });
        let attachmentsText = '';

        if (message.attachments.size > 0) {
            attachmentsText = message.attachments.map(a => {
                if (!imageURL && a.contentType?.startsWith('image/')) imageURL = a.url;

                if (a.contentType?.startsWith('audio/'))
                    return lang === 'ru'
                        ? `Голосовое сообщение: ${a.name} (${a.url})`
                        : `Voice message: ${a.name} (${a.url})`;

                return lang === 'ru'
                    ? `Файл: ${a.name} (${a.url})`
                    : `File: ${a.name} (${a.url})`;
            }).join('\n');

            if (attachmentsText.length > 800) {
                const folderPath = path.join(__dirname, 'attachments');
                if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath);

                const filePath = path.join(folderPath, `attachments_${Date.now()}.txt`);
                fs.writeFileSync(filePath, attachmentsText, 'utf8');

                files.push(new AttachmentBuilder(filePath));

                attachmentField = lang === 'ru'
                    ? 'Вложения превышают лимит, отправлены как файл.'
                    : 'Attachments exceed limit, sent as a file.';
            } else {
                attachmentField = attachmentsText;
            }
        }

        if (attachmentField) {
            deleteEmbed.addFields({
                name: lang === 'ru' ? 'Вложения' : 'Attachments',
                value: attachmentField,
                inline: true
            });
        }

        if (replyField) deleteEmbed.addFields({ name: lang === 'ru' ? 'Ответ' : 'Reply', value: replyField, inline: true });
        if (extraDescription) deleteEmbed.setDescription(extraDescription.length > 4096 ? extraDescription.slice(0, 4093)+'...' : extraDescription);
        if (imageURL) deleteEmbed.setImage(imageURL);
        deleteEmbed.setFooter({ text: `${lang === 'ru' ? 'ID сообщения' : 'Message ID'}: ${message.id} | ${formatTime()}` });

        await sendMessageEmbed(message.guild, deleteEmbed, files);

        tempPaths.forEach(p => {
            try {
                fs.unlinkSync(p);
            } catch (err) {
                console.error('Ошибка при удалении временного файла:', err);
            }
        });
    } catch (error) {
        console.error('Ошибка при логировании удаления сообщения:', error);
    }
});

client.on(Events.MessageCreate, async (message) => {
    try {
        if (!message.guild || message.author?.bot) return;
        upsertStoredMessageFromDiscordMessage(message);
    } catch (err) {
        console.error('Ошибка при сохранении сообщения для логов:', err);
    }
});

client.on('messageUpdate', async (oldMessage, newMessage) => {
    try {
        const storedMessage = getStoredMessageById(newMessage?.id || oldMessage?.id);

        if (newMessage.partial) {
            try {
                await newMessage.fetch();
            } catch {
            }
        }

        if (!newMessage.guild || !newMessage.author || newMessage.author.bot) return;
        const channelId = newMessage.channel?.id || newMessage.channelId;
        if (channelId && (await isChannelIgnored(newMessage.guild.id, channelId))) return;

        const noStoredOldContent = (!oldMessage.content || oldMessage.partial) && !storedMessage?.content;
        const noNewContent = !newMessage.content;
        if (noStoredOldContent && noNewContent) return;

        incrementLogCount();
        const lang = await getGuildLang(newMessage.guild.id); 

        let oldContent = oldMessage.content;
        if ((!oldContent || oldMessage.partial) && storedMessage?.content) {
            oldContent = storedMessage.content;
        }
        if (!oldContent) {
            oldContent = lang === 'ru' ? '[Без сохранённого содержимого]' : '[No stored content]';
        }

        const newContent = newMessage.content || (lang === 'ru' ? '[Без содержания]' : '[No content]');
        if (oldContent === newContent) return; 
        if (newMessage.channel.type === ChannelType.GuildAnnouncement) return;

        const messageLink = `https://discord.com/channels/${newMessage.guild.id}/${newMessage.channel.id}/${newMessage.id}`;

        const embed = new EmbedBuilder()
            .setColor('#fe983e')
            .setTitle(lang === 'ru' ? 'Изменение сообщения' : 'Message Update')
            .setThumbnail(newMessage.author.displayAvatarURL({ dynamic: true, size: 256 }))
            .setDescription(`[${lang === 'ru' ? 'Сообщение' : 'Message'}](${messageLink}) ${lang === 'ru' ? 'было отредактировано' : 'has been edited'}`)
            .addFields(
                { name: lang === 'ru' ? 'Канал:' : 'Channel:', value: `\`${newMessage.channel.name}\` (<#${newMessage.channel.id}>)`, inline: true },
                { name: lang === 'ru' ? 'Автор:' : 'Author:', value: `\`${newMessage.author.tag}\` (<@${newMessage.author.id}>)`, inline: true },
                { name: '', value: '', inline: true },
                { name: lang === 'ru' ? 'До:' : 'Old:', value: oldContent.length > 1024 ? oldContent.slice(0, 1020) + ' ...' : oldContent, inline: true },
                { name: lang === 'ru' ? 'После:' : 'New:', value: newContent.length > 1024 ? newContent.slice(0, 1020) + ' ...' : newContent, inline: true }
            )
            .setFooter({ text: `${lang === 'ru' ? 'ID сообщения' : 'Message ID'}: ${newMessage.id} | ${formatTime()}` });

        await sendMessageEmbed(newMessage.guild, embed);


        upsertStoredMessageFromDiscordMessage(newMessage);
    } catch (err) {
        console.error('Ошибка при обработке messageUpdate:', err);
    }
});

function formatTime(date = new Date(), lang = 'en') {
    return date.toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-US', {
        timeZone: 'Europe/Moscow',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).replace(',', '');
}

// каналы
const pendingChannelChanges = new Map();
async function sendChannelEmbed(guild, embed) {
    dbLogs.get(`SELECT channelID FROM logs_settings WHERE guildID = ?`, [guild.id], async (err, row) => {
        if (!err && row?.channelID) {
            const channel = guild.channels.cache.get(row.channelID);
            if (channel?.isTextBased()) return channel.send({ embeds: [embed] }).catch(console.error);
        }

        dbSettings.get(`
            SELECT channel_id, enabled, mode, webhook_url
            FROM logs
            WHERE server_id = ? AND category = 'Каналы'
        `, [guild.id], (err2, row2) => {
            if (err2 || !row2?.enabled || !row2.channel_id) return;
        
            if (row2.mode === 'webhook' && isValidWebhookUrl(row2.webhook_url)) {
                try {
                    const webhook = new WebhookClient({ url: row2.webhook_url });
                    webhook.send({ embeds: [embed] }).catch(console.error);
                } catch (err) {
                    if (err?.code !== 'WebhookURLInvalid') console.error('Ошибка при отправке через вебхук:', err);
                }
            } else {
                const extraChannel = guild.channels.cache.get(row2.channel_id);
                if (extraChannel?.isTextBased()) {
                    extraChannel.send({ embeds: [embed] }).catch(console.error);
                }
            }
        });
    });
}

client.on('channelCreate', async (channel) => {
    if (channel.guild && (await isChannelIgnored(channel.guild.id, channel.id))) return;
    incrementLogCount();
    const lang = await getGuildLang(channel.guild.id);

    let embedDescription = '';
    let embedTitle = '';

    if (channel.type === 4) {
        embedDescription = lang === 'ru'
            ? `- Категория: \`${channel.name}\`\n- ID: ${channel.id}`
            : `- Category: \`${channel.name}\`\n- ID: ${channel.id}`;
        embedTitle = lang === 'ru' ? 'Создание категории' : 'Category Created';
    } else {
        const channelTypeMap = {0:'text',2:'voice',5:'news',13:'stage',15:'forum'};
        const channelType = channelTypeMap[channel.type] || (lang === 'ru' ? 'неизвестный' : 'unknown');
        embedDescription = lang === 'ru'
            ? `- Канал: \`${channel.name}\`\n- Тип: \`${channelType}\`\n- ID: ${channel.id}`
            : `- Channel: \`${channel.name}\`\n- Type: \`${channelType}\`\n- ID: ${channel.id}`;
        embedTitle = lang === 'ru' ? 'Создание канала' : 'Channel Created';
    }

    const embed = new EmbedBuilder()
        .setColor('#fe983e')
        .setThumbnail(channel.guild.iconURL({ dynamic: true, size: 256 }) || 'https://discord.com/assets/411d8a698dd15ddf.png')
        .setTitle(embedTitle)
        .setDescription(embedDescription)
        .setFooter({ text: lang === 'ru'
            ? `ID сервера: ${channel.guild.id} | ${formatTime()}`
            : `Server ID: ${channel.guild.id} | ${formatTime()}`
        });

    sendChannelEmbed(channel.guild, embed);
});

client.on('channelUpdate', async (oldChannel, newChannel) => {
    dbSettings.get(`SELECT 1 FROM log_ignored_channels WHERE server_id = ? AND channel_id = ?`, [oldChannel.guild.id, oldChannel.id], (err, row) => {
        if (err || row) return;
        runChannelUpdateLog(oldChannel, newChannel);
    });
});

async function runChannelUpdateLog(oldChannel, newChannel) {
    incrementLogCount();
    const lang = await getGuildLang(oldChannel.guild.id);

    const channelChanges = [];

    if (oldChannel.name !== newChannel.name) {
        channelChanges.push(
            lang === 'ru'
                ? `Название: \`${oldChannel.name} → ${newChannel.name}\``
                : `Name: \`${oldChannel.name} → ${newChannel.name}\``
        );
    }

    if (oldChannel.type !== newChannel.type) {
        channelChanges.push(
            lang === 'ru'
                ? `Тип: \`${oldChannel.type} → ${newChannel.type}\``
                : `Type: \`${oldChannel.type} → ${newChannel.type}\``
        );
    }

    if (oldChannel.nsfw !== newChannel.nsfw) {
        channelChanges.push(
            lang === 'ru'
                ? `NSFW: \`${oldChannel.nsfw} → ${newChannel.nsfw}\``
                : `NSFW: \`${oldChannel.nsfw} → ${newChannel.nsfw}\``
        );
    }

    if ('topic' in oldChannel) {
        const oldTopic = oldChannel.topic ?? '';
        const newTopic = newChannel.topic ?? '';
        if (oldTopic !== newTopic) {
            channelChanges.push(
                lang === 'ru'
                    ? `Тема: \`${oldTopic || 'нет'} → ${newTopic || 'нет'}\``
                    : `Topic: \`${oldTopic || 'none'} → ${newTopic || 'none'}\``
            );
        }
    }

    const oldPerms = oldChannel.permissionOverwrites.cache.filter(o => o.type === 'role');
    const newPerms = newChannel.permissionOverwrites.cache.filter(o => o.type === 'role');

    newPerms.forEach(newPerm => {
        const oldPerm = oldPerms.get(newPerm.id);
        if (!oldPerm) {
            const role = oldChannel.guild.roles.cache.get(newPerm.id);
            if (role) {
                channelChanges.push(
                    lang === 'ru'
                        ? `Новые права для роли ${role.name}`
                        : `New permissions for role ${role.name}`
                );
            }
            return;
        }

        if (oldPerm.allow.bitfield !== newPerm.allow.bitfield || oldPerm.deny.bitfield !== newPerm.deny.bitfield) {
            const role = oldChannel.guild.roles.cache.get(newPerm.id);
            if (role) {
                channelChanges.push(
                    lang === 'ru'
                        ? `Права роли ${role.name} изменены`
                        : `Permissions changed for role ${role.name}`
                );
            }
        }
    });

    if (channelChanges.length === 0) return;

    const pendingKey = `${oldChannel.guild.id}:${oldChannel.id}`;
    const timeoutKey = `${pendingKey}:timeout`;

    if (!pendingChannelChanges.has(pendingKey)) {
        pendingChannelChanges.set(pendingKey, {
            guild: oldChannel.guild,
            channelId: oldChannel.id,
            channelName: newChannel.name,
            lang,
            changes: []
        });
    }

    const pending = pendingChannelChanges.get(pendingKey);
    pending.channelName = newChannel.name;
    pending.changes.push(...channelChanges);

    if (!pendingChannelChanges.get(timeoutKey)) {
        pendingChannelChanges.set(timeoutKey, setTimeout(async () => {
            const state = pendingChannelChanges.get(pendingKey);
            if (!state?.changes?.length) return;

            const embed = new EmbedBuilder()
                .setColor('#fe983e')
                .setTitle(state.lang === 'ru' ? 'Изменение канала' : 'Channel Update')
                .setThumbnail(state.guild.iconURL({ dynamic: true, size: 256 }) || 'https://discord.com/assets/411d8a698dd15ddf.png')
                .setDescription([
                    state.lang === 'ru'
                        ? `Канал: \`${state.channelName}\` (<#${state.channelId}>)`
                        : `Channel: \`${state.channelName}\` (<#${state.channelId}>)`,
                    state.lang === 'ru'
                        ? `ID канала: \`${state.channelId}\``
                        : `Channel ID: \`${state.channelId}\``,
                    ...state.changes
                ].join('\n'))
                .setFooter({
                    text: state.lang === 'ru'
                        ? `ID сервера: ${state.guild.id} | ${formatTime()}`
                        : `Server ID: ${state.guild.id} | ${formatTime()}`
                });

            sendChannelEmbed(state.guild, embed);

            pendingChannelChanges.delete(pendingKey);
            pendingChannelChanges.delete(timeoutKey);
        }, 1000));
    }
}

client.on('channelDelete', async (channel) => {
    if (channel.guild && (await isChannelIgnored(channel.guild.id, channel.id))) return;
    incrementLogCount();
    const lang = await getGuildLang(channel.guild.id);

    const channelTypeMap = {0:'Text',2:'Voice',4:'Category',5:'News',15:'Forum'};
    const channelType = channelTypeMap[channel.type] || (lang === 'ru' ? 'Неизвестный' : 'Unknown');
    const parentName = channel.parent?.name || (lang === 'ru' ? 'Без категории' : 'No category');

    const embed = new EmbedBuilder()
        .setColor('#fe983e')
        .setTitle(lang === 'ru' ? 'Удаление канала' : 'Channel Deleted')
        .setThumbnail(channel.guild.iconURL({ dynamic: true, size: 256 }) || 'https://discord.com/assets/411d8a698dd15ddf.png')
        .setDescription(lang === 'ru'
            ? `- Канал: \`${channel.name}\` (\`${channel.id}\`)\n- Тип: ${channelType}\n- Категория: \`${parentName}\``
            : `- Channel: \`${channel.name}\` (\`${channel.id}\`)\n- Type: ${channelType}\n- Category: \`${parentName}\``)
        .setFooter({ text: lang === 'ru'
            ? `ID сервера: ${channel.guild.id} | ${formatTime()}`
            : `Server ID: ${channel.guild.id} | ${formatTime()}`
        });

    sendChannelEmbed(channel.guild, embed);

    dbLogs.get(`SELECT * FROM logs_settings WHERE guildID = ? AND channelID = ?`, [channel.guild.id, channel.id], (err, row) => {
        if (err) return console.error(err);
        if (row) dbLogs.run(`DELETE FROM logs_settings WHERE guildID = ? AND channelID = ?`, [channel.guild.id, channel.id], err => { if (err) console.error(err); });
    });
});



// эмодзи и стикеры
async function logStickerChange(guild, sticker, action, oldName = null) {
    const lang = await getGuildLang(guild.id);
    incrementLogCount();

    const buildEmbed = () => {
        let description = '';

        if (lang === 'ru') {
            description += `- Имя: \`${sticker.name}\`\n`;
            description += `- ID: \`${sticker.id}\`\n`;
        } else {
            description += `- Name: \`${sticker.name}\`\n`;
            description += `- ID: \`${sticker.id}\`\n`;
        }

        if (action === 'updated' || action === 'изменено') {
            description += lang === 'ru'
                ? `- Изменения: \`${oldName} → ${sticker.name}\``
                : `- Changes: \`${oldName} → ${sticker.name}\``;
        } else if (action === 'added' || action === 'добавлен') {
            description += lang === 'ru'
                ? `- Действие: добавлен`
                : `- Action: added`;
        } else if (action === 'deleted' || action === 'удалён') {
            description += lang === 'ru'
                ? `- Действие: удалён`
                : `- Action: deleted`;
        }

        return new EmbedBuilder()
            .setColor('#fe983e')
            .setTitle(lang === 'ru' ? 'Изменения стикеров' : 'Sticker Changes')
            .setDescription(description)
            .setThumbnail(sticker.url)
            .setFooter({
                text: lang === 'ru'
                    ? `ID сервера: ${guild.id} | ${formatTime()}`
                    : `Server ID: ${guild.id} | ${formatTime()}`
            });
    };

    const sendEmbed = async (channel) => {
        if (!channel?.isTextBased()) return;
        await channel.send({ embeds: [buildEmbed()] }).catch(console.error);
    };

    dbLogs.get(
        `SELECT channelID FROM logs_settings WHERE guildID = ?`,
        [guild.id],
        async (err, row) => {
            if (!err && row?.channelID) {
                const channel = guild.channels.cache.get(row.channelID);
                if (channel?.isTextBased()) return sendEmbed(channel);
            }

            dbSettings.get(
                `SELECT channel_id, enabled, mode, webhook_url
                 FROM logs
                 WHERE server_id = ? AND category = 'Эмодзи и стикеры'`,
                [guild.id],
                async (err2, row2) => {
                    if (err2 || !row2?.enabled || !row2.channel_id) return;

                    if (row2.mode === 'webhook' && isValidWebhookUrl(row2.webhook_url)) {
                        try {
                            const webhook = new WebhookClient({ url: row2.webhook_url });
                            await webhook.send({ embeds: [buildEmbed()] });
                        } catch (err) {
                            if (err?.code !== 'WebhookURLInvalid') console.error('Ошибка при отправке через вебхук:', err);
                        }
                    } else {
                        const extraChannel = guild.channels.cache.get(row2.channel_id);
                        if (extraChannel?.isTextBased()) sendEmbed(extraChannel);
                    }
                }
            );
        }
    );
}


async function logEmojiChange(guild, emoji, action, oldName = null, author = null) {
    const lang = await getGuildLang(guild.id);
    incrementLogCount();

    let description = '';
    if (lang === 'ru') {
        description += `- Имя: \`${emoji.name}\`\n`;
        description += `- ID: \`${emoji.id}\`\n`;
    } else {
        description += `- Name: \`${emoji.name}\`\n`;
        description += `- ID: \`${emoji.id}\`\n`;
    }

    if (action === 'updated' || action === 'изменено') {
        description += lang === 'ru'
            ? `- Изменения: \`${oldName} → ${emoji.name}\``
            : `- Changes: \`${oldName} → ${emoji.name}\``;
    } else if (action === 'added' || action === 'добавлен') {
        description += lang === 'ru'
            ? `- Действие: добавлен`
            : `- Action: added`;
        if (author) {
            description += lang === 'ru'
                ? `\n- Автор: \`${author.username}\` (<@${author.id}>)`
                : `\n- Author: \`${author.username}\` (<@${author.id}>)`;
        }
    } else if (action === 'deleted' || action === 'удалён') {
        description += lang === 'ru'
            ? `- Действие: удалён`
            : `- Action: deleted`;
    }

    const embed = new EmbedBuilder()
        .setColor('#fe983e')
        .setTitle(lang === 'ru' ? 'Изменения эмодзи на сервере' : 'Emoji Changes')
        .setDescription(description)
        .setThumbnail(emoji.url)
        .setFooter({
            text: lang === 'ru'
                ? `ID сервера: ${guild.id} | ${formatTime()}`
                : `Server ID: ${guild.id} | ${formatTime()}`
        });

    const sendEmbed = async (channel) => {
        if (!channel?.isTextBased()) return;
        await channel.send({ embeds: [embed] }).catch(console.error);
    };

    dbLogs.get(`SELECT channelID FROM logs_settings WHERE guildID = ?`, [guild.id], async (err, row) => {
        if (!err && row?.channelID) {
            const channel = guild.channels.cache.get(row.channelID);
            if (channel?.isTextBased()) return sendEmbed(channel);
        }

        dbSettings.get(`
            SELECT channel_id, enabled, mode, webhook_url
            FROM logs
            WHERE server_id = ? AND category = 'Эмодзи и стикеры'
        `, [guild.id], (err2, row2) => {
            if (err2 || !row2?.enabled || !row2.channel_id) return;

            if (row2.mode === 'webhook' && isValidWebhookUrl(row2.webhook_url)) {
                try {
                    const webhook = new WebhookClient({ url: row2.webhook_url });
                    webhook.send({ embeds: [embed] }).catch(console.error);
                } catch (err) {
                    if (err?.code !== 'WebhookURLInvalid') console.error('Ошибка при отправке через вебхук:', err);
                }
            } else {
                const extraChannel = guild.channels.cache.get(row2.channel_id);
                if (extraChannel?.isTextBased()) {
                    sendEmbed(extraChannel);
                }
            }
        });
    });
}


client.on('stickerCreate', debounce(sticker => logStickerChange(sticker.guild, sticker, 'added'), 1000));
client.on('stickerUpdate', debounce((oldSticker, newSticker) => logStickerChange(newSticker.guild, newSticker, 'updated', oldSticker.name), 1000));
client.on('stickerDelete', debounce(sticker => logStickerChange(sticker.guild, sticker, 'deleted'), 1000));

client.on('emojiCreate', debounce(emoji => logEmojiChange(emoji.guild, emoji, 'added'), 1000));
client.on('emojiUpdate', debounce((oldEmoji, newEmoji) => logEmojiChange(newEmoji.guild, newEmoji, 'updated', oldEmoji.name), 1000));
client.on('emojiDelete', debounce(emoji => logEmojiChange(emoji.guild, emoji, 'deleted'), 1000));



// Новый участник / бот присоединился
const invites = new Map();
const invitesCache = new Map();

client.on('ready', async () => {
    for (const guild of client.guilds.cache.values()) {
        try {
            const me = guild.members.me ?? await guild.members.fetchMe();
            if (!me.permissions.has(PermissionFlagsBits.ManageGuild)) continue;
            const invs = await guild.invites.fetch();
            invitesCache.set(guild.id, invs);
        } catch {}
    }

    setInterval(() => {
        if (client.channels.cache.size > 50000) {
            const channelsToSweep = client.channels.cache.filter(c => c && !c.guild?.members.cache.has(client.user.id));
            channelsToSweep.forEach(c => client.channels.cache.delete(c.id));
        }
        if (client.guilds.cache.size > 1000) {
            const guildsToSweep = client.guilds.cache.filter(g => !g.members.cache.has(client.user.id));
            guildsToSweep.forEach(g => client.guilds.cache.delete(g.id));
        }
        if (client.users.cache.size > 100000) {
            const usersToSweep = client.users.cache.filter(u => !client.guilds.cache.some(g => g.members.cache.has(u.id)));
            usersToSweep.forEach(u => client.users.cache.delete(u.id));
        }
    }, 30 * 60 * 1000);
});

client.on('guildMemberAdd', async member => {
    const lang = await getGuildLang(member.guild.id);
    incrementLogCount();

    const isBot = member.user.bot;
    const joinDate = `<t:${Math.floor(member.user.createdTimestamp / 1000)}:f>`;
    const joinDateR = `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`;

    let entryMethod = lang === 'ru' ? 'Не удалось определить' : 'Could not determine';

    if (!isBot) {
        try {
            const oldInvites = invites.get(member.guild.id) || new Map();
            const newInvites = await member.guild.invites.fetch();
            const usedInvite = newInvites.find(i => (oldInvites.get(i.code)?.uses || 0) < i.uses);
            invites.set(member.guild.id, new Map(newInvites.map(i => [i.code, i])));

            if (usedInvite) {
                const inviteURL = `https://discord.gg/${usedInvite.code}`;
                entryMethod = lang === 'ru'
                    ? `По [ссылке](${inviteURL}) от ${usedInvite.inviter?.username || 'нет прав'} (<@${usedInvite.inviter?.id || 'неизвестно'}>)`
                    : `Via [invite](${inviteURL}) from ${usedInvite.inviter?.username || 'not permission'} (<@${usedInvite.inviter?.id || 'unknown'}>)`;
            }
        } catch (err) {
            console.warn(`Ошибка при определении инвайта: ${err.message}`);
        }
    } else {
        try {
            const logs = await member.guild.fetchAuditLogs({ type: AuditLogEvent.BotAdd, limit: 1 });
            const entry = logs.entries.find(e => e.target.id === member.user.id);
            if (entry) entryMethod = lang === 'ru'
                ? `Бот был добавлен \`${entry.executor.username || 'нет прав'}\` (<@${entry.executor.id || 'неизвестно'}>)`
                : `Bot added by \`${entry.executor.username || 'not permission'}\` (<@${entry.executor.id || 'unknown'}>)`;
        } catch (err) {
            console.warn(`Ошибка при определении кто добавил бота: ${err.message}`);
        }
    }

    const embed = new EmbedBuilder()
        .setColor('#fe983e')
        .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
        .setTitle(isBot
            ? (lang === 'ru' ? 'Бот был добавлен' : 'Bot added')
            : (lang === 'ru' ? 'Участник присоединился' : 'Member joined'))
        .addFields(
            { name: lang === 'ru' ? 'Имя' : 'Name', value: `\`${member.user.username}\``, inline: true },
            { name: lang === 'ru' ? 'ID' : 'ID', value: `\`${member.user.id}\``, inline: true },
            { name: lang === 'ru' ? 'Аккаунт создан' : 'Account created', value: `${joinDate} (${joinDateR})`, inline: false },
            { name: lang === 'ru' ? 'Участников на сервере' : 'Members count', value: `\`${member.guild.memberCount}\``, inline: true },
            { name: lang === 'ru' ? 'Способ входа' : 'Entry method', value: entryMethod, inline: true }
        )
        .setFooter({ text: lang === 'ru'
            ? `ID сервера: ${member.guild.id} | ${formatTime()}`
            : `Server ID: ${member.guild.id} | ${formatTime()}`
        });

    dbLogs.get(`SELECT channelID FROM logs_settings WHERE guildID = ?`, [member.guild.id], (err, row) => {
        if (!err && row?.channelID) {
            const channel = member.guild.channels.cache.get(row.channelID);
            if (channel?.isTextBased()) {
                channel.send({ embeds: [embed] }).catch(console.error);
                return;
            }
        }

        dbSettings.get(`
            SELECT channel_id, enabled, mode, webhook_url
            FROM logs
            WHERE server_id = ? AND category = 'Участники'
        `, [member.guild.id], (err2, row2) => {
            if (err2 || !row2?.enabled || !row2.channel_id) return;
        
            if (row2.mode === 'webhook' && isValidWebhookUrl(row2.webhook_url)) {
                try {
                    const webhook = new WebhookClient({ url: row2.webhook_url });
                    webhook.send({ embeds: [embed] }).catch(console.error);
                } catch (err) {
                    if (err?.code !== 'WebhookURLInvalid') console.error('Ошибка при отправке через вебхук:', err);
                }
            } else {
                const extraChannel = member.guild.channels.cache.get(row2.channel_id);
                if (extraChannel?.isTextBased()) {
                    extraChannel.send({ embeds: [embed] }).catch(console.error);
                }
            }
        });
    });
});

function normalizeNickname(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
}
const lastNicknameChange = new Map();
client.on('guildMemberUpdate', async (oldMember, newMember) => {
    if (newMember.user.bot) return;

    if (oldMember.nickname === newMember.nickname) return;

    const oldNickRaw = 'nickname' in oldMember ? oldMember.nickname : null;
    const newNickRaw = 'nickname' in newMember ? newMember.nickname : null;

    const oldNickNorm = normalizeNickname(oldNickRaw);
    const newNickNorm = normalizeNickname(newNickRaw);

    if (oldNickNorm === newNickNorm) return;

    const lang = await getGuildLang(newMember.guild.id);

    const oldNick = oldNickNorm ?? oldMember.user.username;
    const newNick = newNickNorm ?? newMember.user.username;

    if (oldNick === newNick) return;

    try {
        const logs = await newMember.guild.fetchAuditLogs({
            limit: 10,
            type: AuditLogEvent.MemberUpdate
        });

        const nickChangeEntry = logs.entries.find(e =>
            e.target.id === newMember.id &&
            Date.now() - e.createdTimestamp < 60000 &&
            e.changes?.some(c => c.key === 'nick')
        );

        if (!nickChangeEntry) return;

    } catch (err) {
        console.error('Ошибка получения аудит-лога никнейма:', err);
        return;
    }

    const dedupeKey = `${newMember.guild.id}:${newMember.id}:${oldNickNorm ?? ''}→${newNickNorm ?? ''}`;
    const lastTs = lastNicknameChange.get(dedupeKey) || 0;
    if (Date.now() - lastTs < 60_000) return;
    lastNicknameChange.set(dedupeKey, Date.now());

    const embed = new EmbedBuilder()
        .setColor('#fe983e')
        .setThumbnail(newMember.user.displayAvatarURL({ dynamic: true, size: 256 }))
        .setTitle(lang === 'ru' ? 'Изменение никнейма' : 'Nickname Change')
        .addFields(
            {
                name: lang === 'ru' ? 'Участник' : 'Member',
                value: `\`${newMember.user.tag}\` (<@${newMember.id}>)`
            },
            {
                name: lang === 'ru' ? 'Никнейм' : 'Nickname',
                value: `\`${oldNick}\` → \`${newNick}\``
            }
        )
        .setFooter({
            text: `${lang === 'ru' ? 'ID участника' : 'Member ID'}: ${newMember.id} | ${formatTime()}`
        });

    try {
        const logs = await newMember.guild.fetchAuditLogs({
            limit: 10,
            type: AuditLogEvent.MemberUpdate
        });

        const entry = logs.entries.find(e =>
            e.target.id === newMember.id &&
            Date.now() - e.createdTimestamp < 60000 &&
            e.changes?.some(c => c.key === 'nick')
        );

        embed.addFields({
            name: lang === 'ru' ? 'Кто изменил' : 'Changed By',
            value: entry
                ? `\`${entry.executor.tag}\` (<@${entry.executor.id}>)`
                : (lang === 'ru' ? 'Не удалось определить' : 'Unknown')
        });

    } catch (err) {
        console.error('Ошибка получения аудит-лога никнейма:', err);
    }

    await sendLogEmbed(newMember.guild, embed, 'Участники');
});

client.on('guildMemberRemove', async member => {
    const lang = await getGuildLang(member.guild.id);
    incrementLogCount();

    const isBot = member.user.bot;
    const joinDate = `<t:${Math.floor(member.user.createdTimestamp / 1000)}:f>`;
    const joinDateR = `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`;

    const joinedTs = typeof member.joinedTimestamp === 'number'
        ? member.joinedTimestamp
        : (member.joinedAt instanceof Date ? member.joinedAt.getTime() : null);

    let timeOnServer;

    if (!joinedTs) {
        timeOnServer = lang === 'ru' ? 'Неизвестно' : 'Unknown';
    } else {
        const durationMs = Math.max(0, Date.now() - joinedTs);
        const seconds = Math.floor(durationMs / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);
        const months = Math.floor(days / 30);
        const years = Math.floor(days / 365);
        
        if (years > 0)
            timeOnServer = `${years} ${lang === 'ru' ? 'г' : 'y'}, ${months % 12} ${lang === 'ru' ? 'мес' : 'mo'}`;
        else if (months > 0)
            timeOnServer = `${months} ${lang === 'ru' ? 'мес' : 'mo'}, ${days % 30} ${lang === 'ru' ? 'дн' : 'd'}`;
        else if (days > 0)
            timeOnServer = `${days} ${lang === 'ru' ? 'дн' : 'd'}, ${hours % 24} ${lang === 'ru' ? 'ч' : 'h'}`;
        else if (hours > 0)
            timeOnServer = `${hours} ${lang === 'ru' ? 'ч' : 'h'}, ${minutes % 60} ${lang === 'ru' ? 'мин' : 'min'}`;
        else if (minutes > 0)
            timeOnServer = `${minutes} ${lang === 'ru' ? 'мин' : 'min'}`;
        else
            timeOnServer = `${seconds} ${lang === 'ru' ? 'сек' : 'sec'}`;
    }
    
    let leaveType = isBot
        ? (lang === 'ru' ? 'Бот покинул сервер!' : 'Bot left the server!')
        : (lang === 'ru' ? 'Участник покинул сервер!' : 'User left the server!');

    try {
        const logsKick = await member.guild.fetchAuditLogs({ type: AuditLogEvent.MemberKick, limit: 1 });
        const kickEntry = logsKick.entries.first();
        if (kickEntry && kickEntry.target.id === member.id && (Date.now() - kickEntry.createdTimestamp) < 5000) {
            leaveType = lang === 'ru' ? 'Кик с сервера!' : 'Kicked from server!';
        }
    } catch (err) {
        console.error('Ошибка при проверке аудита');
    }

    const embed = new EmbedBuilder()
        .setColor('#fe983e')
        .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
        .setTitle(leaveType)
        .setDescription(`${isBot ? (lang === 'ru' ? 'Бот' : 'Bot') : (lang === 'ru' ? 'Участник' : 'User')} ${member.user.username} (<@${member.user.id}>)\n${lang === 'ru' ? 'Дата регистрации' : 'Registration date'}: ${joinDate} (${joinDateR})`)
        .addFields(
            { name: lang === 'ru' ? 'Пробыл на сервере' : 'Time on server', value: timeOnServer, inline: true },
            { name: lang === 'ru' ? 'Участников на сервере' : 'Members count', value: `${member.guild.memberCount}`, inline: true }
        )
        .setFooter({ text: `${lang === 'ru' ? 'ID участника' : 'Member ID'}: ${member.user.id} | ${formatTime()}` });

    dbLogs.get(`SELECT channelID FROM logs_settings WHERE guildID = ?`, [member.guild.id], (err, row) => {
        if (!err && row?.channelID) {
            const channel = member.guild.channels.cache.get(row.channelID);
            if (channel?.isTextBased()) {
                channel.send({ embeds: [embed] }).catch(console.error);
                return;
            }
        }

        dbSettings.get(`
            SELECT channel_id, enabled, mode, webhook_url
            FROM logs
            WHERE server_id = ? AND category = 'Участники'
        `, [member.guild.id], (err2, row2) => {
            if (err2 || !row2?.enabled || !row2.channel_id) return;
        
            if (row2.mode === 'webhook' && isValidWebhookUrl(row2.webhook_url)) {
                try {
                    const webhook = new WebhookClient({ url: row2.webhook_url });
                    webhook.send({ embeds: [embed] }).catch(console.error);
                } catch (err) {
                    if (err?.code !== 'WebhookURLInvalid') console.error('Ошибка при отправке через вебхук:', err);
                }
            } else {
                const extraChannel = member.guild.channels.cache.get(row2.channel_id);
                if (extraChannel?.isTextBased()) {
                    extraChannel.send({ embeds: [embed] }).catch(console.error);
                }
            }
        });
    });
});

client.on('guildBanAdd', async (ban) => {
    const guild = ban?.guild;
    const user = ban?.user;

    if (!guild) return;
    if (!user) {
        console.warn('guildBanAdd: user is undefined, пропускаю.');
        return;
    }

    const lang = await getGuildLang(guild.id);
    incrementLogCount();

    let executor = lang === 'ru' ? 'Неизвестно' : 'Unknown';
    let reason = lang === 'ru' ? 'Не указана' : 'Not specified';

    try {
        const logs = await guild.fetchAuditLogs({
            type: AuditLogEvent.MemberBanAdd,
            limit: 5
        });

        const entry = logs.entries.find(e => e.target?.id === user.id);

        if (entry?.executor) {
            executor = `${entry.executor.username} (<@${entry.executor.id}>)`;
        }

        if (entry?.reason) {
            reason = entry.reason;
        }

    } catch (err) {
        console.error('Ошибка при получении audit log для бана');
    }

    const avatar = user.displayAvatarURL({ dynamic: true, size: 256 });

    const embed = new EmbedBuilder()
        .setColor('#fe983e')
        .setThumbnail(avatar)
        .setTitle(lang === 'ru' ? 'Участник забанен' : 'Member banned')
        .addFields(
            { name: lang === 'ru' ? 'Имя' : 'Name', value: user.username, inline: true },
            { name: 'ID', value: user.id, inline: true },
            { name: ' ', value: '', inline: true },
            { name: lang === 'ru' ? 'Модератор' : 'Moderator', value: executor, inline: true },
            { name: lang === 'ru' ? 'Причина' : 'Reason', value: reason, inline: true }
        )
        .setFooter({
            text: lang === 'ru'
                ? `ID сервера: ${guild.id} | ${formatTime()}`
                : `Server ID: ${guild.id} | ${formatTime()}`
        });

    dbLogs.get(
        `SELECT channelID FROM logs_settings WHERE guildID = ?`,
        [guild.id],
        (err, row) => {
            if (!err && row?.channelID) {
                const channel = guild.channels.cache.get(row.channelID);

                if (channel?.isTextBased()) {
                    channel.send({ embeds: [embed] }).catch(console.error);
                    return;
                }
            }

            dbSettings.get(`
                SELECT channel_id, enabled, mode, webhook_url
                FROM logs
                WHERE server_id = ? AND category = 'Участники'
            `, [guild.id], (err2, row2) => {
                if (err2 || !row2?.enabled || !row2.channel_id) return;
            
                if (row2.mode === 'webhook' && isValidWebhookUrl(row2.webhook_url)) {
                    try {
                        const webhook = new WebhookClient({ url: row2.webhook_url });
                        webhook.send({ embeds: [embed] }).catch(console.error);
                    } catch (err) {
                        if (err?.code !== 'WebhookURLInvalid') console.error('Ошибка при отправке через вебхук:', err);
                    }
                } else {
                    const extraChannel = guild.channels.cache.get(row2.channel_id);
                    if (extraChannel?.isTextBased()) {
                        extraChannel.send({ embeds: [embed] }).catch(console.error);
                    }
                }
            });
        }
    );
});

client.on('guildBanRemove', async (ban) => {
    const guild = ban?.guild;
    const user = ban?.user;

    if (!guild) return;
    if (!user) {
        console.warn('guildBanRemove: user is undefined, пропускаю.');
        return;
    }

    const lang = await getGuildLang(guild.id);
    incrementLogCount();

    let executor = lang === 'ru' ? 'Неизвестно' : 'Unknown';

    try {
        const logs = await guild.fetchAuditLogs({
            type: AuditLogEvent.MemberBanRemove,
            limit: 5
        });

        const entry = logs.entries.find(e => e.target?.id === user.id);
        if (entry?.executor) {
            executor = `${entry.executor.username} (<@${entry.executor.id}>)`;
        }

    } catch (err) {
        console.error('Ошибка при получении audit log для разбана');
    }

    const avatar = user.displayAvatarURL({ dynamic: true, size: 256 });

    const embed = new EmbedBuilder()
        .setColor('#fe983e')
        .setThumbnail(avatar)
        .setTitle(lang === 'ru' ? 'Участник разбанен' : 'Member unbanned')
        .addFields(
            { name: lang === 'ru' ? 'Имя' : 'Name', value: user.username, inline: true },
            { name: 'ID', value: user.id, inline: true },
            { name: ' ', value: '', inline: true },
            { name: lang === 'ru' ? 'Модератор' : 'Moderator', value: executor, inline: true }
        )
        .setFooter({
            text: lang === 'ru'
                ? `ID сервера: ${guild.id} | ${formatTime()}`
                : `Server ID: ${guild.id} | ${formatTime()}`
        });

    dbLogs.get(
        `SELECT channelID FROM logs_settings WHERE guildID = ?`,
        [guild.id],
        (err, row) => {
            if (!err && row?.channelID) {
                const channel = guild.channels.cache.get(row.channelID);

                if (channel?.isTextBased()) {
                    channel.send({ embeds: [embed] }).catch(console.error);
                    return;
                }
            }

            dbSettings.get(`
                SELECT channel_id, enabled, mode, webhook_url
                FROM logs
                WHERE server_id = ? AND category = 'Участники'
            `, [guild.id], (err2, row2) => {
                if (err2 || !row2?.enabled || !row2.channel_id) return;
            
                if (row2.mode === 'webhook' && isValidWebhookUrl(row2.webhook_url)) {
                    try {
                        const webhook = new WebhookClient({ url: row2.webhook_url });
                        webhook.send({ embeds: [embed] }).catch(console.error);
                    } catch (err) {
                        if (err?.code !== 'WebhookURLInvalid') console.error('Ошибка при отправке через вебхук:', err);
                    }
                } else {
                    const extraChannel = guild.channels.cache.get(row2.channel_id);
                    if (extraChannel?.isTextBased()) {
                        extraChannel.send({ embeds: [embed] }).catch(console.error);
                    }
                }
            });
        }
    );
});


client.on('guildMemberUpdate', async (oldMember, newMember) => {
    const lang = await getGuildLang(newMember.guild.id);
    incrementLogCount();

    const oldMute = oldMember.communicationDisabledUntilTimestamp || 0;
    const newMute = newMember.communicationDisabledUntilTimestamp || 0;
    
    if (oldMute === newMute) return;

    const isMuted = newMute > Date.now();
    const until = isMuted ? `<t:${Math.floor(newMute / 1000)}:f>` : null;

    let executorName = lang === 'ru' ? 'Неизвестно' : 'Unknown';
    try {
        const logs = await newMember.guild.fetchAuditLogs({ 
            type: AuditLogEvent.MemberUpdate, 
            limit: 5 
        });
        
        const entry = logs.entries.find(e =>
            e.target.id === newMember.id &&
            e.changes.some(c => c.key === 'communication_disabled_until') &&
            (Date.now() - e.createdTimestamp < 5000)
        );
    
        if (!entry) return;
    
        executorName = `${entry.executor.username} (<@${entry.executor.id}>)`;
    
    } catch (err) {
        console.error('Ошибка аудита для мута:', err);
        return;
    }

    const statusText = isMuted
        ? lang === 'ru' ? `Замучен до ${until}` : `Muted until ${until}`
        : lang === 'ru' ? `Размучен` : `Unmuted`;

    const embed = new EmbedBuilder()
        .setColor('#fe983e')
        .setThumbnail(newMember.user.displayAvatarURL({ dynamic: true, size: 256 }))
        .setTitle(isMuted ? (lang === 'ru' ? 'Пользователь замучен' : 'User muted') : (lang === 'ru' ? 'Пользователь размучен' : 'User unmuted'))
        .addFields(
            { name: lang === 'ru' ? 'Участник' : 'Member', value: `${newMember.user.username} (<@${newMember.user.id}>)` },
            { name: lang === 'ru' ? 'Статус' : 'Status', value: statusText },
            { name: lang === 'ru' ? 'Модератор' : 'Moderator', value: executorName }
        )
        .setFooter({ text: `${lang === 'ru' ? 'ID участника' : 'Member ID'}: ${newMember.user.id} | ${formatTime()}` });

    dbLogs.get(`SELECT channelID FROM logs_settings WHERE guildID = ?`, [newMember.guild.id], (err, row) => {
        if (!err && row?.channelID) {
            const channel = newMember.guild.channels.cache.get(row.channelID);
            if (channel?.isTextBased()) {
                channel.send({ embeds: [embed] }).catch(console.error);
                return;
            }
        }

        dbSettings.get(`
            SELECT channel_id, enabled, mode, webhook_url
            FROM logs
            WHERE server_id = ? AND category = 'Участники'
        `, [newMember.guild.id], (err2, row2) => {
            if (err2 || !row2?.enabled || !row2.channel_id) return;
        
            if (row2.mode === 'webhook' && isValidWebhookUrl(row2.webhook_url)) {
                try {
                    const webhook = new WebhookClient({ url: row2.webhook_url });
                    webhook.send({ embeds: [embed] }).catch(console.error);
                } catch (err) {
                    if (err?.code !== 'WebhookURLInvalid') console.error('Ошибка при отправке через вебхук:', err);
                }
            } else {
                const extraChannel = newMember.guild.channels.cache.get(row2.channel_id);
                if (extraChannel?.isTextBased()) extraChannel.send({ embeds: [embed] }).catch(console.error);
            }
        });
    });
});

// войсы
const joinTimes = new Map();

dbVoice.run(`
    CREATE TABLE IF NOT EXISTS voice (
        serverid TEXT,
        servername TEXT,
        userid TEXT,
        username TEXT,
        time TEXT,
        joinTimestamp INTEGER,
        PRIMARY KEY(serverid, userid)
    )
`);

function setVoice(serverId, serverName, userId, username, time, joinTimestamp, callback) {
    dbVoice.run(`
        INSERT INTO voice (serverid, servername, userid, username, time, joinTimestamp)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(serverid, userid) DO UPDATE SET
            servername = excluded.servername,
            username = excluded.username,
            time = excluded.time,
            joinTimestamp = excluded.joinTimestamp
    `, [serverId, serverName, userId, username, time, joinTimestamp], callback);
}

async function updateVoiceStats() {
    for (const guild of client.guilds.cache.values()) {
        const lang = await getGuildLang(guild.id);
        const voiceMembers = guild.members.cache.filter(member => {
            if (member.user.bot) return false;
            if (!member.voice.channel) return false;
            return true;
        });

        for (const member of voiceMembers.values()) {
            const userId = member.user.id;
            let joinTime = joinTimes.get(userId);

            if (!joinTime) {
                const row = await new Promise(resolve => {
                    dbVoice.get(
                        `SELECT joinTimestamp FROM voice WHERE serverid = ? AND userid = ?`,
                        [guild.id, userId],
                        (err, row) => resolve(err ? null : row)
                    );
                });
                joinTime = row?.joinTimestamp || Date.now();
                joinTimes.set(userId, joinTime);
            }

            const delta = Date.now() - joinTime;

            await new Promise(resolve => {
                setVoice(
                    guild.id,
                    guild.name,
                    userId,
                    member.user.username,
                    formatDuration(delta, lang),
                    joinTime,
                    err => {
                        if (err) console.error("Ошибка записи в БД (voice stats):", err);
                        resolve();
                    }
                );
            });
        }
    }
}

setInterval(() => {
    updateVoiceStats().catch(err => console.error("Ошибка при обновлении voice stats:", err));
}, 20000);

client.on('voiceStateUpdate', async (oldState, newState) => {
    const member = newState.member;
    if (!member || member.user.bot) return;

    const userId = member.user.id;
    const oldChannel = oldState.channelId;
    const newChannel = newState.channelId;
    const guildId = newState.guild?.id;
    if (guildId && ((newChannel && (await isChannelIgnored(guildId, newChannel))) || (oldChannel && (await isChannelIgnored(guildId, oldChannel))))) return;

    const now = Date.now();
    const lang = await getGuildLang(newState.guild.id);

    if (oldChannel === newChannel) return;

    dbLogs.get(`SELECT channelID FROM logs_settings WHERE guildID = ?`, [newState.guild.id], async (err, row) => {
        if (err) return;

        const logChannel = row?.channelID ? newState.guild.channels.cache.get(row.channelID) : null;
        let description = '';
        let delta = 0;

        if (!oldChannel && newChannel) {
            joinTimes.set(userId, now);
            await setVoice(newState.guild.id, newState.guild.name, userId, member.user.username, '0s', now, err => {
                if (err) console.error(err);
            });

            description = `${lang === 'ru' ? 'Участник' : 'Member'} ${member.user.username} (<@${userId}>) ${lang === 'ru' ? 'подключился к' : 'joined'} <#${newChannel}>`;
        }
        else if (oldChannel && !newChannel) {
            let joinTime = joinTimes.get(userId);

            if (!joinTime) {
                const rowDB = await new Promise(resolve => {
                    dbVoice.get(
                        `SELECT joinTimestamp FROM voice WHERE serverid = ? AND userid = ?`,
                        [newState.guild.id, userId],
                        (err, row) => resolve(err ? null : row)
                    );
                });
                joinTime = rowDB?.joinTimestamp || now;
            }

            delta = now - joinTime;
            joinTimes.delete(userId);

            await setVoice(newState.guild.id, newState.guild.name, userId, member.user.username, formatDuration(delta, lang), null, err => {
                if (err) console.error(err);
            });

            description = `${lang === 'ru' ? 'Участник' : 'Member'} ${member.user.username} (<@${userId}>) ${lang === 'ru' ? 'покинул' : 'left'} <#${oldChannel}> ${lang === 'ru' ? 'спустя' : 'after'} ${formatDuration(delta, lang)}`;
        }
        else if (oldChannel && newChannel && oldChannel !== newChannel) {
            let joinTime = joinTimes.get(userId);
            if (!joinTime) {
                const rowDB = await new Promise(resolve => {
                    dbVoice.get(
                        `SELECT joinTimestamp FROM voice WHERE serverid = ? AND userid = ?`,
                        [newState.guild.id, userId],
                        (err, row) => resolve(err ? null : row)
                    );
                });
                joinTime = rowDB?.joinTimestamp || now;
            }
            delta = now - joinTime;

            await setVoice(newState.guild.id, newState.guild.name, userId, member.user.username, formatDuration(delta, lang), now, err => {
                if (err) console.error(err);
            });

            joinTimes.set(userId, now);

            description = `${lang === 'ru' ? 'Участник' : 'Member'} ${member.user.username} (<@${userId}>) ${lang === 'ru' ? 'перешёл из' : 'moved from'} <#${oldChannel}> ${lang === 'ru' ? 'в' : 'to'} <#${newChannel}> ${lang === 'ru' ? 'спустя' : 'after'} ${formatDuration(delta, lang)}`;
        }

        if (!description) return;

        const embed = new EmbedBuilder()
            .setColor('#fe983e')
            .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
            .setTitle(lang === 'ru' ? 'Голосовые каналы' : 'Voice Channels')
            .setDescription(description)
            .setFooter({ text: `${lang === 'ru' ? 'ID участника' : 'Member ID'}: ${userId} | ${formatTime()}` });

        if (logChannel?.isTextBased()) {
            logChannel.send({ embeds: [embed] }).catch(console.error);
        }

        dbSettings.get(`
            SELECT channel_id, enabled, mode, webhook_url
            FROM logs
            WHERE server_id = ? AND category = 'Войсы'
        `, [newState.guild.id], (err, row2) => {
            if (err) return console.error(err);
            if (!row2?.enabled || !row2.channel_id) return;

            if (row2.mode === 'webhook' && isValidWebhookUrl(row2.webhook_url)) {
                try {
                    const webhook = new WebhookClient({ url: row2.webhook_url });
                    webhook.send({ embeds: [embed] }).catch(console.error);
                } catch (err) {
                    if (err?.code !== 'WebhookURLInvalid') console.error('Ошибка при отправке через вебхук:', err);
                }
            } else {
                const extraChannel = newState.guild.channels.cache.get(row2.channel_id);
                if (extraChannel?.isTextBased()) extraChannel.send({ embeds: [embed] }).catch(console.error);
            }
        });
    });
});


async function fetchWebhookSafe(guild, id) {
    try {
        return await guild.fetchWebhook(id);
    } catch {
        return null;
    }
}
function sendWebhookLog(guild, embed) {
    dbLogs.get(`
        SELECT channelID FROM logs_settings
        WHERE guildID = ?
    `, [guild.id], (err, row) => {
        if (!err && row?.channelID) {
            const ch = guild.channels.cache.get(row.channelID);
            if (ch?.isTextBased()) {
                ch.send({ embeds: [embed] }).catch(console.error);
                return;
            }
        }

        dbSettings.get(`
            SELECT channel_id, enabled, mode, webhook_url FROM logs
            WHERE server_id = ? AND category = 'Вебхуки'
        `, [guild.id], (e2, row2) => {
            if (e2 || !row2?.enabled || !row2.channel_id) return;

            if (row2.mode === 'webhook' && isValidWebhookUrl(row2.webhook_url)) {
                try {
                    const webhook = new WebhookClient({ url: row2.webhook_url });
                    webhook.send({ embeds: [embed] }).catch(console.error);
                } catch (err) {
                    if (err?.code !== 'WebhookURLInvalid') console.error('Ошибка при отправке через вебхук:', err);
                }
            } else {
                const extra = guild.channels.cache.get(row2.channel_id);
                if (extra?.isTextBased()) {
                    extra.send({ embeds: [embed] }).catch(console.error);
                }
            }
        });
    });
}

async function diffWebhook(entry, guild) {
    const fields = [];
    const lang = await getGuildLang(guild.id);
    incrementLogCount();

    if (!entry.changes) return fields;

    for (const change of entry.changes) {
        const name = change.key;

        if (name === "name") {
            fields.push({
                name: lang === 'ru' ? "Имя" : "Name",
                value: `\`${change.old ?? (lang === 'ru' ? "неизвестно" : "unknown")}\` → \`${change.new ?? (lang === 'ru' ? "неизвестно" : "unknown")}\``
            });
        }

        if (name === "avatar") {
            const oldAva = change.old
                ? `https://cdn.discordapp.com/avatars/${entry.target.id}/${change.old}.png`
                : lang === 'ru' ? "отсутствует" : "none";

            const newAva = change.new
                ? `https://cdn.discordapp.com/avatars/${entry.target.id}/${change.new}.png`
                : lang === 'ru' ? "отсутствует" : "none";

            fields.push({ name: lang === 'ru' ? "Аватар" : "Avatar", value: `${oldAva} → ${newAva}` });
        }

        if (name === "channel_id") {
            const oldCh = change.old ? `<#${change.old}>` : lang === 'ru' ? "неизвестно" : "unknown";
            const newCh = change.new ? `<#${change.new}>` : lang === 'ru' ? "неизвестно" : "unknown";
            fields.push({ name: lang === 'ru' ? "Канал" : "Channel", value: `${oldCh} → ${newCh}` });
        }

        if (name === "type") {
            fields.push({
                name: lang === 'ru' ? "Тип" : "Type",
                value: `${change.old ?? "?"} → ${change.new ?? "?"}`
            });
        }
    }

    return fields;
}

function getWebhookAvatar(id, hash) {
    return `https://cdn.discordapp.com/avatars/${id}/${hash}.png`;
}

async function diffChannelOverwrite(entry, guild) {
    const fields = [];
    const lang = await getGuildLang(guild.id);

    if (!entry.changes) return fields;


    const permissionBits = {
        CreateInstantInvite: 0x0000000000000001,
        KickMembers: 0x0000000000000002,
        BanMembers: 0x0000000000000004,
        Administrator: 0x0000000000000008,
        ManageChannels: 0x0000000000000010,
        ManageGuild: 0x0000000000000020,
        ViewAuditLog: 0x0000000000000040,
        ViewChannel: 0x0000000000000080,
        SendMessages: 0x0000000000000100,
        SendTTSMessages: 0x0000000000000200,
        ManageMessages: 0x0000000000000400,
        EmbedLinks: 0x0000000000000800,
        AttachFiles: 0x0000000000002000,
        ReadMessageHistory: 0x0000000000001000,
        MentionEveryone: 0x0000000000000800,
        UseExternalEmojis: 0x0000000000800000,
        AddReactions: 0x0000000000400000,
        Connect: 0x0000000000002000,
        Speak: 0x0000000000004000,
        Stream: 0x0000000002000000,
        MuteMembers: 0x0000000000008000,
        DeafenMembers: 0x0000000000010000,
        MoveMembers: 0x0000000000020000,
        UseVAD: 0x0000000000040000,
        ChangeNickname: 0x0000000000080000,
        ManageNicknames: 0x0000000000100000,
        ManageRoles: 0x0000000000200000,
        ManageWebhooks: 0x0000000000400000,
        ManageEmojisAndStickers: 0x0000000000800000,
        UseApplicationCommands: 0x0000080000000000,
        ManageEvents: 0x0000020000000000,
        ManageThreads: 0x0000000008000000,
        CreatePublicThreads: 0x0000000010000000,
        CreatePrivateThreads: 0x0000000020000000,
        SendMessagesInThreads: 0x0000000040000000,
        ModerateMembers: 0x0000000200000000
    };


    const permissionNames = {
        CreateInstantInvite: { ru: 'Создание приглашений', en: 'Create Invite' },
        KickMembers: { ru: 'Кик участников', en: 'Kick Members' },
        BanMembers: { ru: 'Бан участников', en: 'Ban Members' },
        Administrator: { ru: 'Администратор', en: 'Administrator' },
        ManageChannels: { ru: 'Управление каналами', en: 'Manage Channels' },
        ManageGuild: { ru: 'Управление сервером', en: 'Manage Server' },
        ViewAuditLog: { ru: 'Просмотр аудит-логов', en: 'View Audit Log' },
        ViewChannel: { ru: 'Просмотр каналов', en: 'View Channel' },
        SendMessages: { ru: 'Отправка сообщений', en: 'Send Messages' },
        SendTTSMessages: { ru: 'TTS сообщения', en: 'Send TTS Messages' },
        ManageMessages: { ru: 'Удаление сообщений', en: 'Manage Messages' },
        EmbedLinks: { ru: 'Вставка ссылок', en: 'Embed Links' },
        AttachFiles: { ru: 'Прикрепление файлов', en: 'Attach Files' },
        ReadMessageHistory: { ru: 'История сообщений', en: 'Read Message History' },
        MentionEveryone: { ru: 'Упоминание everyone', en: 'Mention Everyone' },
        UseExternalEmojis: { ru: 'Внешние эмодзи', en: 'Use External Emojis' },
        AddReactions: { ru: 'Добавление реакций', en: 'Add Reactions' },
        Connect: { ru: 'Подключение', en: 'Connect' },
        Speak: { ru: 'Говорить', en: 'Speak' },
        Stream: { ru: 'Стрим', en: 'Stream' },
        MuteMembers: { ru: 'Мутить', en: 'Mute Members' },
        DeafenMembers: { ru: 'Оглушать', en: 'Deafen Members' },
        MoveMembers: { ru: 'Перемещать', en: 'Move Members' },
        UseVAD: { ru: 'Голосовая активность', en: 'Use Voice Activity' },
        ChangeNickname: { ru: 'Менять ник', en: 'Change Nickname' },
        ManageNicknames: { ru: 'Управлять никами', en: 'Manage Nicknames' },
        ManageRoles: { ru: 'Управлять ролями', en: 'Manage Roles' },
        ManageWebhooks: { ru: 'Вебхуки', en: 'Manage Webhooks' },
        ManageEmojisAndStickers: { ru: 'Эмодзи и стикеры', en: 'Manage Emojis & Stickers' },
        UseApplicationCommands: { ru: 'Слэш-команды', en: 'Use Application Commands' },
        ManageEvents: { ru: 'События', en: 'Manage Events' },
        ManageThreads: { ru: 'Треды', en: 'Manage Threads' },
        CreatePublicThreads: { ru: 'Публичные треды', en: 'Create Public Threads' },
        CreatePrivateThreads: { ru: 'Приватные треды', en: 'Create Private Threads' },
        SendMessagesInThreads: { ru: 'Сообщения в тредах', en: 'Send Messages in Threads' },
        ModerateMembers: { ru: 'Тайм-ауты', en: 'Moderate Members' }
    };

    const formatPermissions = (bits, lang) => {
        if (!bits || bits === 0) return lang === 'ru' ? 'Нет' : 'None';
        
        const perms = [];
        for (const [permName, permBits] of Object.entries(permissionBits)) {
            if (bits & permBits) {
                const names = permissionNames[permName];
                if (names) {
                    perms.push(names[lang === 'ru' ? 'ru' : 'en']);
                }
            }
        }
        return perms.length > 0 ? perms.join(', ') : `0x${bits.toString(16).toUpperCase()}`;
    };

    for (const change of entry.changes) {
        const name = change.key;

        if (name === "allow") {
            const oldBits = change.old ?? 0;
            const newBits = change.new ?? 0;
            

            if (oldBits === newBits) continue;
            

            const added = newBits & ~oldBits;
            const removed = oldBits & ~newBits;
            
            let diffText = '';
            if (added && added !== 0) {
                const addedPerms = [];
                for (const [permName, permBits] of Object.entries(permissionBits)) {
                    if (added & permBits) {
                        const names = permissionNames[permName];
                        if (names) {
                            addedPerms.push(names[lang === 'ru' ? 'ru' : 'en']);
                        }
                    }
                }
                if (addedPerms.length > 0) {
                    diffText = lang === 'ru' ? `+ ${addedPerms.join(', ')}` : `+ ${addedPerms.join(', ')}`;
                }
            }
            
            if (removed && removed !== 0) {
                const removedPerms = [];
                for (const [permName, permBits] of Object.entries(permissionBits)) {
                    if (removed & permBits) {
                        const names = permissionNames[permName];
                        if (names) {
                            removedPerms.push(names[lang === 'ru' ? 'ru' : 'en']);
                        }
                    }
                }
                if (removedPerms.length > 0) {
                    const prefix = diffText ? ' | ' : '';
                    diffText += `${prefix}${lang === 'ru' ? '- ' : '- '}${removedPerms.join(', ')}`;
                }
            }
            
            if (diffText) {
                fields.push({ name: lang === 'ru' ? "Разрешения" : 'Permissions', value: diffText });
            }
        }

        if (name === "deny") {
            const oldBits = change.old ?? 0;
            const newBits = change.new ?? 0;
            

            if (oldBits === newBits) continue;
            

            const added = newBits & ~oldBits;
            const removed = oldBits & ~newBits;
            
            let diffText = '';
            if (added && added !== 0) {
                const addedPerms = [];
                for (const [permName, permBits] of Object.entries(permissionBits)) {
                    if (added & permBits) {
                        const names = permissionNames[permName];
                        if (names) {
                            addedPerms.push(names[lang === 'ru' ? 'ru' : 'en']);
                        }
                    }
                }
                if (addedPerms.length > 0) {
                    diffText = lang === 'ru' ? `+ ${addedPerms.join(', ')}` : `+ ${addedPerms.join(', ')}`;
                }
            }
            
            if (removed && removed !== 0) {
                const removedPerms = [];
                for (const [permName, permBits] of Object.entries(permissionBits)) {
                    if (removed & permBits) {
                        const names = permissionNames[permName];
                        if (names) {
                            removedPerms.push(names[lang === 'ru' ? 'ru' : 'en']);
                        }
                    }
                }
                if (removedPerms.length > 0) {
                    const prefix = diffText ? ' | ' : '';
                    diffText += `${prefix}${lang === 'ru' ? '- ' : '- '}${removedPerms.join(', ')}`;
                }
            }
            
            if (diffText) {
                fields.push({ name: lang === 'ru' ? "Запреты" : 'Denies', value: diffText });
            }
        }
    }

    return fields;
}

function sendChannelOverwriteLog(guild, embed) {
    dbLogs.get(`SELECT channelID FROM logs_settings WHERE guildID = ?`, [guild.id], async (err, row) => {
        if (!err && row?.channelID) {
            const channel = guild.channels.cache.get(row.channelID);
            if (channel?.isTextBased()) {
                channel.send({ embeds: [embed] }).catch(console.error);
                return;
            }
        }

        dbSettings.get(`
            SELECT channel_id, enabled, mode, webhook_url FROM logs
            WHERE server_id = ? AND category = 'Каналы'
        `, [guild.id], (e2, row2) => {
            if (e2 || !row2?.enabled || !row2.channel_id) return;

            if (row2.mode === 'webhook' && isValidWebhookUrl(row2.webhook_url)) {
                try {
                    const webhook = new WebhookClient({ url: row2.webhook_url });
                    webhook.send({ embeds: [embed] }).catch(console.error);
                } catch (err) {
                    if (err?.code !== 'WebhookURLInvalid') console.error('Ошибка при отправке через вебхук:', err);
                }
            } else {
                const extra = guild.channels.cache.get(row2.channel_id);
                if (extra?.isTextBased()) {
                    extra.send({ embeds: [embed] }).catch(console.error);
                }
            }
        });
    });
}

client.on("guildAuditLogEntryCreate", async (entry, guild) => {
    if (!guild) return;

    const lang = await getGuildLang(guild.id);
    incrementLogCount();

    try {
        const action = entry.action;
        const executor = entry.executor;
        const target = entry.target;
        const unknownText = lang === 'ru' ? "неизвестно" : "unknown";

        if ([AuditLogEvent.ChannelOverwriteCreate, AuditLogEvent.ChannelOverwriteUpdate, AuditLogEvent.ChannelOverwriteDelete].includes(action)) {
            incrementLogCount();

            let executorLabel = unknownText;
            if (executor) {
                if (executor.tag) {
                    executorLabel = `${executor.tag} (<@${executor.id}>)`;
                } else if (executor.username) {
                    executorLabel = `${executor.username} (<@${executor.id}>)`;
                } else {
                    executorLabel = `<@${executor.id}>`;
                }
            }

            const channelId = target?.id || entry.changes?.find(c => c.key === 'channel_id')?.new || null;
            const channel = channelId ? guild.channels.cache.get(channelId) : null;
            const channelName = channel
                ? `#${channel.name} (<#${channel.id}>)`
                : (target?.name ? `#${target.name}` : unknownText);


            const overwriteTargetId = entry.extra?.id || null;
            const rawType = entry.extra?.type ?? entry.changes?.find(c => c.key === 'type')?.new;

            let overwriteType = rawType;
            if (overwriteType === 0 || overwriteType === '0') overwriteType = 'role';
            if (overwriteType === 1 || overwriteType === '1') overwriteType = 'member';


            if (!overwriteType && overwriteTargetId) {
                if (guild.roles.cache.has(overwriteTargetId)) {
                    overwriteType = 'role';
                } else {
                    try {
                        await guild.members.fetch(overwriteTargetId);
                        overwriteType = 'member';
                    } catch {
                        overwriteType = 'role';
                    }
                }
            }
            
            const targetType = overwriteType === 'member' 
                ? (lang === 'ru' ? "Участник" : "Member") 
                : (lang === 'ru' ? "Роль" : "Role");

            let targetName = unknownText;
            let targetMention = "";
            
            if (overwriteTargetId) {
                try {
                    if (overwriteType === 'member') {
                        const member = await guild.members.fetch(overwriteTargetId);
                        targetName = member.user.tag || member.user.username || unknownText;
                        targetMention = ` (<@${member.id}>)`;
                    } else {
                        const role = guild.roles.cache.get(overwriteTargetId);
                        targetName = role?.name || entry.extra?.role_name || unknownText;
                        if (role && role.id !== guild.id) {
                            targetMention = ` (<@&${role.id}>)`;
                        } else if (role && role.id === guild.id) {
                            targetMention = ` (<@&${role.id}>)`;
                        }
                    }
                } catch (err) {
                    console.error('Error fetching overwrite target:', err);
                }
            }

            let embed = new EmbedBuilder()
                .setColor('#fe983e')
                .setThumbnail(executor ? executor.displayAvatarURL({ dynamic: true, size: 256 }) : null)

            if (action === AuditLogEvent.ChannelOverwriteCreate) {
                const diff = await diffChannelOverwrite(entry, guild);

                embed
                    .setTitle(lang === 'ru' ? "Разрешения канала созданы" : "Channel Permissions Created")
                    .addFields(
                        { name: lang === 'ru' ? "Канал" : "Channel", value: channelName },
                        { name: lang === 'ru' ? "Цель" : "Target", value: `${targetName}` },
                        { name: lang === 'ru' ? "Кем создано" : "Created By", value: executorLabel }
                    )
                .setThumbnail(executor ? executor.displayAvatarURL({ dynamic: true, size: 256 }) : null)

                if (diff.length > 0) {
                    embed.addFields(...diff);
                }


                const dedupeKey = `${guild.id}:${channelId}:${overwriteTargetId}`;
                recentOverwriteCreates.set(dedupeKey, Date.now());
                setTimeout(() => recentOverwriteCreates.delete(dedupeKey), 5000);

                sendChannelOverwriteLog(guild, embed);
            }

            if (action === AuditLogEvent.ChannelOverwriteDelete) {
                embed
                    .setTitle(lang === 'ru' ? "Разрешения канала удалены" : "Channel Permissions Deleted")
                    .addFields(
                        { name: lang === 'ru' ? "Канал" : "Channel", value: channelName },
                        { name: lang === 'ru' ? "Цель" : "Target", value: `${targetName}` },
                        { name: lang === 'ru' ? "Кем удалено" : "Deleted By", value: executorLabel }
                    )
                    .setThumbnail(executor ? executor.displayAvatarURL({ dynamic: true, size: 256 }) : null)

                sendChannelOverwriteLog(guild, embed);
            }

            if (action === AuditLogEvent.ChannelOverwriteUpdate) {
                const diff = await diffChannelOverwrite(entry, guild);


                if (diff.length === 0) {
                    console.log('  No meaningful changes detected, skipping log');
                    return;
                }

                embed
                    .setTitle(lang === 'ru' ? "Разрешения канала обновлены" : "Channel Permissions Updated")
                    .addFields(
                        { name: lang === 'ru' ? "Канал" : "Channel", value: channelName },
                        { name: lang === 'ru' ? "Цель" : "Target", value: `${targetName}` },
                        { name: lang === 'ru' ? "Кем обновлено" : "Updated By", value: executorLabel }
                    );

                if (diff.length > 0) {
                    embed.addFields(...diff);
                }

                console.log('  Sending log...');
                sendChannelOverwriteLog(guild, embed);
            }
        }
    } catch (err) {
        console.error(err);
    }
});


function sendStageInstanceLog(guild, embed) {
    dbLogs.get(`SELECT channelID FROM logs_settings WHERE guildID = ?`, [guild.id], async (err, row) => {
        if (!err && row?.channelID) {
            const channel = guild.channels.cache.get(row.channelID);
            if (channel?.isTextBased()) {
                channel.send({ embeds: [embed] }).catch(console.error);
                return;
            }
        }

        dbSettings.get(`
            SELECT channel_id, enabled, mode, webhook_url FROM logs
            WHERE server_id = ? AND category = 'Эвенты'
        `, [guild.id], (e2, row2) => {
            if (e2 || !row2?.enabled || !row2.channel_id) return;

            if (row2.mode === 'webhook' && isValidWebhookUrl(row2.webhook_url)) {
                try {
                    const webhook = new WebhookClient({ url: row2.webhook_url });
                    webhook.send({ embeds: [embed] }).catch(console.error);
                } catch (err) {
                    if (err?.code !== 'WebhookURLInvalid') console.error('Ошибка при отправке через вебхук:', err);
                }
            } else {
                const extra = guild.channels.cache.get(row2.channel_id);
                if (extra?.isTextBased()) {
                    extra.send({ embeds: [embed] }).catch(console.error);
                }
            }
        });
    });
}

client.on("guildAuditLogEntryCreate", async (entry, guild) => {
    if (!guild) return;

    const lang = await getGuildLang(guild.id);

    try {
        const action = entry.action;
        const executor = entry.executor;
        const target = entry.target;
        const unknownText = lang === 'ru' ? "неизвестно" : "unknown";
        const executorLabel = executor
            ? `${executor.tag || executor.username || unknownText} (<@${executor.id}>)`
            : unknownText;


        if ([AuditLogEvent.StageInstanceCreate, AuditLogEvent.StageInstanceUpdate, AuditLogEvent.StageInstanceDelete].includes(action)) {
            incrementLogCount();

            const channel = target?.channelId ? guild.channels.cache.get(target.channelId) : null;
            const channelName = channel ? `#${channel.name} (<#${channel.id}>)` : (lang === 'ru' ? "неизвестно" : "unknown");
            
            let subject = target?.subject || (lang === 'ru' ? "неизвестно" : "unknown");
            if (subject.length > 100) subject = subject.substring(0, 97) + '...';

            let embed = new EmbedBuilder()
                .setColor('#fe983e')
                .setFooter({ text: `Stage Instance | ${formatTime()}` });

            if (action === AuditLogEvent.StageInstanceCreate) {
                embed
                    .setTitle(lang === 'ru' ? "Stage-сессия создана" : "Stage Instance Created")
                    .setThumbnail(guild.iconURL({ dynamic: true, size: 256 }) || 'https://discord.com/assets/411d8a698dd15ddf.png')
                    .addFields(
                        { name: lang === 'ru' ? "Тема" : "Subject", value: subject },
                        { name: lang === 'ru' ? "Канал" : "Channel", value: channelName },
                        { name: lang === 'ru' ? "Кем создано" : "Created By", value: executorLabel }
                    );
            }

            if (action === AuditLogEvent.StageInstanceDelete) {
                embed
                    .setTitle(lang === 'ru' ? "Stage-сессия удалена" : "Stage Instance Deleted")
                    .setThumbnail(guild.iconURL({ dynamic: true, size: 256 }) || 'https://discord.com/assets/411d8a698dd15ddf.png')
                    .addFields(
                        { name: lang === 'ru' ? "Тема" : "Subject", value: subject },
                        { name: lang === 'ru' ? "Канал" : "Channel", value: channelName },
                        { name: lang === 'ru' ? "Кем удалено" : "Deleted By", value: executorLabel }
                    );
            }

            if (action === AuditLogEvent.StageInstanceUpdate) {
                const changes = [];
                
                if (entry.changes) {
                    for (const change of entry.changes) {
                        if (change.key === 'subject') {
                            const oldSubject = (change.old && change.old !== null) ? change.old : '-';
                            const newSubject = (change.new && change.new !== null) ? change.new : '-';
                            changes.push({
                                name: lang === 'ru' ? "Тема" : "Subject",
                                value: `${oldSubject} → ${newSubject}`
                            });
                        }
                        if (change.key === 'privacy_level') {
                            const privacyMap = {
                                1: { ru: 'Группа', en: 'Guild Only' },
                                2: { ru: 'Публично', en: 'Public' }
                            };
                            changes.push({
                                name: lang === 'ru' ? "Уровень приватности" : "Privacy Level",
                                value: `${privacyMap[change.old]?.[lang === 'ru' ? 'ru' : 'en'] || change.old} → ${privacyMap[change.new]?.[lang === 'ru' ? 'ru' : 'en'] || change.new}`
                            });
                        }
                    }
                }


                if (changes.length === 0 && target?.subject) {
                    changes.push({
                        name: lang === 'ru' ? "Тема" : "Subject",
                        value: target.subject
                    });
                }

                embed
                    .setTitle(lang === 'ru' ? "Stage-сессия обновлена" : "Stage Instance Updated")
                    .setThumbnail(guild.iconURL({ dynamic: true, size: 256 }) || 'https://discord.com/assets/411d8a698dd15ddf.png')
                    .addFields(
                        { name: lang === 'ru' ? "Канал" : "Channel", value: channelName },
                        { name: lang === 'ru' ? "Кем обновлено" : "Updated By", value: executorLabel },
                        ...changes
                    );
            }

            sendStageInstanceLog(guild, embed);
        }
    } catch (err) {
        console.error(err);
    }
});

const servers_log = '';

client.on('guildCreate', async (guild) => {
    incrementLogCount();

    const members = guild.memberCount;
    try {
        const owner = await guild.fetchOwner();
        const creator = guild.ownerId === owner.id ? `\`${owner.user.tag} [${owner.user.id}]\`` : 'Неизвестно';

        const logChannel = await client.channels.fetch(servers_log);
        if (!logChannel) return console.error(`Не найден канал для логов`);

        const embed = new EmbedBuilder()
            .setColor('#fe983e')
            .setTitle('Бот добавлен на сервер')
            .setDescription(`Бот был добавлен на сервер:\n\`${guild.name} [${guild.id}]\``)
            .addFields(
                { name: 'Участников:', value: `\`+${members}\``},
                { name: 'Создатель:', value: creator }
            )
            .setThumbnail(guild.iconURL({ size: 1024, extension: 'webp' }) || 'https://discord.com/assets/411d8a698dd15ddf.png')


        await logChannel.send({ embeds: [embed] });
    } catch (error) {
        console.error(`Ошибка при получении владельца сервера: ${error}`);
    }
});


client.on('guildDelete', async (guild) => {
    incrementLogCount();

    dbLogs.run(`DELETE FROM logs_settings WHERE guildID = ?`, [guild.id], (err) => {
        if (err) console.error(`Ошибка при удалении из logs_settings:`, err);
    });

    dbSettings.run(`DELETE FROM logs WHERE server_id = ?`, [guild.id], (err) => {
        if (err) console.error(`Ошибка при удалении из logs:`, err);
    });

    const logChannel = await client.channels.fetch(servers_log);
    if (!logChannel) return console.error(`Не найден канал для логов`);

    const members = guild.memberCount;
    let creator = 'Неизвестно';
    try {
        const owner = await guild.fetchOwner();
        creator = guild.ownerId === owner.id ? `\`${owner.user.tag} [${owner.user.id}]\`` : 'Неизвестно';
    } catch {}

    const embed = new EmbedBuilder()
        .setColor('#fe983e')
        .setTitle('Бот удален с сервера')
        .setDescription(`Бот был удален с сервера:\n\`${guild.name} [${guild.id}]\``)
        .addFields(
            { name: 'Участников:', value: `\`-${members}\`` },
            { name: 'Создатель:', value: creator }
        )
        .setThumbnail(guild.iconURL({ size: 1024, extension: 'webp' }) || 'https://discord.com/assets/411d8a698dd15ddf.png')


    await logChannel.send({ embeds: [embed] });
});

};

