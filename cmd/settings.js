const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField, PermissionFlagsBits } = require('discord.js');
const sqlite3 = require('sqlite3');

const categories = [
    { name: 'Войсы', emoji: '🎤' },
    { name: 'Каналы', emoji: '📝' },
    { name: 'Сообщения', emoji: '📋' },
    { name: 'Роли', emoji: '👥' },
    { name: 'Эмодзи и стикеры', emoji: '😀' },
    { name: 'Реакции', emoji: '✅' },
    { name: 'Треды', emoji: '🧵' },
    { name: 'Участники', emoji: '👤' },
    { name: 'Сервер', emoji: '🏰' },
    { name: 'Вебхуки', emoji: '🗯️' },
    { name: 'Инвайты', emoji: '🔗' },
    { name: 'Эвенты', emoji: '📅' },
    { name: 'Автомодерация', emoji: '⚙️' }
];

function translateCategory(name) {
    const translations = {
        'Войсы': 'Voices',
        'Каналы': 'Channels',
        'Сообщения': 'Messages',
        'Роли': 'Roles',
        'Эмодзи и стикеры': 'Emojis & Stickers',
        'Реакции': 'Reactions',
        'Треды': 'Threads',
        'Участники': 'Members',
        'Сервер': 'Server',
        'Вебхуки': 'Webhook',
        'Инвайты': 'Invites',
        'Эвенты': 'Events',
        'Автомодерация': 'Automoderation'
    };
    return translations[name] || name;
}

module.exports = {
    deferEphemeral: true,
    data: new SlashCommandBuilder()
        .setName('settings')
        .setDescription('Настройки логов по категориям')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction, client, { getGuildLang, incrementCommandsHandled }) {
        const guildID = interaction.guild.id;
        const lang = await getGuildLang(guildID) || 'ru';

        if (await client.isGuildBanned(interaction.guild.id)) {
            return interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle(lang === 'ru' ? 'Доступ запрещён' : 'Access Denied')
                        .setDescription(
                            lang === 'ru'
                        ? 'Этот сервер заблокирован для использования бота! Если вы считаете это ошибкой, обратитесь в [поддержку](https://discord.gg/4qa7E9rN7U)'
                        : 'This server is banned from using the bot! If you believe this is a mistake, contact [support](https://discord.gg/4qa7E9rN7U)'
                        )
                        .setColor('#fe983e')
                ]
            });
        }
        
        if (await client.isUserBanned(interaction.user.id)) {
            return interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle(lang === 'ru' ? 'Доступ запрещён' : 'Access Denied')
                        .setDescription(
                            lang === 'ru'
                        ? 'Вы заблокированы для использования бота! Если вы считаете это ошибкой, обратитесь в [поддержку](https://discord.gg/)'
                        : 'You are banned from using the bot! If you believe this is a mistake, contact [support](https://discord.gg/)'
                        )
                        .setColor('#fe983e')
                ]
            });
        }

        incrementCommandsHandled();

        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            const embed = new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle(lang === 'ru' ? 'Ошибка доступа' : 'Access Error')
                .setDescription(lang === 'ru'
                    ? 'У вас нет прав администратора для использования этой команды.'
                    : 'You do not have administrator permissions to use this command.');

            return interaction.editReply({ embeds: [embed] });
        }

        const dbLogs = new sqlite3.Database('./db/logs.db');
        const dbSettings = new sqlite3.Database('./db/settings.db');

        dbLogs.get(`SELECT * FROM logs_settings WHERE guildID = ?`, [guildID], (err, logRow) => {
            if (err) {
                console.error(err);
                return interaction.editReply({ content: 'Ошибка базы данных.', ephemeral: true });
            }

            if (logRow) {
                const embed = new EmbedBuilder()
                    .setTitle(lang === 'ru' ? 'Логи уже включены' : 'Logs Already Enabled')
                    .setDescription(lang === 'ru'
                        ? 'Сначала отключите лог через команду `/log`, чтобы настроить категории через `/settings` заново.'
                        : 'First disable logs using the `/log` command before configuring categories with `/settings`.')
                    .setColor('#d9534f');

                return interaction.editReply({ embeds: [embed], ephemeral: true });
            }

            dbSettings.run(`CREATE TABLE IF NOT EXISTS logs (
                category TEXT,
                server_name TEXT,
                server_id TEXT,
                channel_name TEXT,
                channel_id TEXT,
                enabled INTEGER,
                PRIMARY KEY (server_id, category)
            )`, (err) => {
                if (err) {
                    console.error(err);
                    return interaction.editReply({ content: 'Ошибка базы данных.', ephemeral: true });
                }

                dbSettings.all(`SELECT * FROM logs WHERE server_id = ?`, [guildID], (err, rows) => {
                    if (err) {
                        console.error(err);
                        return interaction.editReply({ content: 'Ошибка базы данных.', ephemeral: true });
                    }

                    dbSettings.all(`SELECT channel_id FROM log_ignored_channels WHERE server_id = ? ORDER BY rowid DESC LIMIT 5`, [guildID], (errIgnored, ignoredRows) => {
                        if (errIgnored) ignoredRows = [];

                        const enabledCount = rows.filter(r => r.enabled).length;
                        const totalCount = categories.length;

                        const embed = new EmbedBuilder()
                            .setTitle(lang === 'ru' ? 'Настройка категорий логов' : 'Log Categories Settings')
                            .setDescription(lang === 'ru'
                                ? `Настроено категорий: \`${enabledCount}/${totalCount}\`\n\nНажмите кнопку ниже, чтобы настроить логи для категорий.`
                                : `Configured categories: \`${enabledCount}/${totalCount}\`\n\nClick the button below to configure logs for categories.`)
                            .setColor('#fe983e')
                            .setThumbnail(client.user.displayAvatarURL({ dynamic: true, size: 256 }));

                        const logChannels = rows.slice(0, 5);
                        if (logChannels.length > 0) {
                            const logList = logChannels.map(r => {
                                const status = r.enabled ? '✅' : '❌';
                                const cat = categories.find(c => c.name === r.category);
                                const catName = cat ? (lang === 'ru' ? r.category : translateCategory(r.category)) : r.category;
                                return `${status} <#${r.channel_id}> • ${catName}`;
                            }).join('\n');
                            embed.addFields({
                                name: lang === 'ru' ? 'Каналы с логами' : 'Log channels',
                                value: logList,
                                inline: false
                            });
                        } else {
                            embed.addFields({
                                name: lang === 'ru' ? 'Каналы с логами' : 'Log channels',
                                value: lang === 'ru' ? 'Нет настроенных каналов' : 'No channels configured',
                                inline: false
                            });
                        }

                        const ignoredList = (ignoredRows || []).length > 0
                            ? (ignoredRows || []).map(r => `<#${r.channel_id}>`).join('\n')
                            : (lang === 'ru' ? 'Нет игнорируемых каналов' : 'No ignored channels');
                        embed.addFields({   
                            name: lang === 'ru' ? 'Игнорируемые каналы' : 'Ignored channels' ,
                            value: ignoredList,
                            inline: false
                        });

                        const rowBtn = new ActionRowBuilder();
                        rowBtn.addComponents(
                            new ButtonBuilder()
                                .setCustomId('setup_logs_new')
                                .setLabel(lang === 'ru' ? 'Настроить логи' : 'Setup logs')
                                .setStyle(ButtonStyle.Primary)
                                .setEmoji('⚙️')
                        );
                        if (rows.length > 0) {
                            rowBtn.addComponents(
                                new ButtonBuilder()
                                    .setCustomId('setup_ignored_channels')
                                    .setLabel(lang === 'ru' ? 'Игнорируемые каналы' : 'Ignored channels')
                                    .setStyle(ButtonStyle.Secondary)
                                    .setEmoji('🚫')
                            );
                        }

                        return interaction.editReply({ embeds: [embed], components: [rowBtn], ephemeral: true });
                    });
                });
            });
        });
    }
};
