const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const sqlite3 = require('sqlite3');

module.exports = {
    deferEphemeral: true,
    data: new SlashCommandBuilder()
        .setName('log')
        .setDescription('Установить или отключить лог-канал для сервера')
        .addChannelOption(option =>
            option.setName('канал')
                .setDescription('Выберите канал для логов')
                .setRequired(true)
                .addChannelTypes(ChannelType.GuildText)
        )
        .addStringOption(option =>
            option.setName('режим')
                .setDescription('Выберите режим')
                .setRequired(true)
                .addChoices(
                    { name: 'включить', value: 'enable' },
                    { name: 'выключить', value: 'disable' }
                )
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction, client, { getGuildLang, incrementCommandsHandled }) {
        if (!interaction || typeof interaction.isChatInputCommand !== 'function' || !interaction.isChatInputCommand()) return;
        if (!interaction.options) {
            if (interaction.deferred) await interaction.editReply({ content: 'Ошибка: неверный тип взаимодействия.' }).catch(() => {});
            return;
        }
        const guildID = interaction.guild.id;
        const guildName = interaction.guild.name;
        const mode = interaction.options.getString('режим');
        const channel = interaction.options.getChannel('канал');
        const authorName = interaction.user.tag;
        const authorID = interaction.user.id;
        const lang = await getGuildLang(guildID);

        incrementCommandsHandled();

        const dbLogs = new sqlite3.Database('./db/logs.db');

        dbLogs.run(`
            CREATE TABLE IF NOT EXISTS logs_settings (
                guildID TEXT PRIMARY KEY,
                channelID TEXT,
                channelName TEXT,
                guildName TEXT,
                authorName TEXT,
                authorID TEXT
            )
        `);

        const dbSettings = new sqlite3.Database('./db/settings.db');

        dbSettings.run(`
            CREATE TABLE IF NOT EXISTS logs (
                category TEXT,
                server_name TEXT,
                server_id TEXT,
                channel_name TEXT,
                channel_id TEXT,
                enabled INTEGER,
                PRIMARY KEY (server_id, category)
            )
        `);

        dbSettings.get(
            `SELECT * FROM logs WHERE server_id = ? LIMIT 1`,
            [guildID],
            async (err, logRow) => {
                if (err) {
                    console.error(err);
                    return interaction.editReply({ content: 'Ошибка базы данных.' });
                }

                const channel = interaction.options.getChannel('канал');

                if (!channel || channel.type !== ChannelType.GuildText) {
                    return interaction.editReply({
                        embeds: [
                            new EmbedBuilder()
                                .setTitle(lang === 'ru' ? 'Ошибка канала' : 'Channel Error')
                                .setDescription(lang === 'ru' ? 'Канал не найден или он не текстовый.' : 'Channel not found or it is not a text channel.')
                                .setColor('#d9534f')
                        ]
                    });
                }
                
                const botMember = interaction.guild.members.me;
                const perms = channel.permissionsFor(botMember);
                
                if (!perms || !perms.has([
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.SendMessages,
                    PermissionFlagsBits.EmbedLinks
                ])) {
                    return interaction.editReply({
                        embeds: [
                            new EmbedBuilder()
                                .setTitle(lang === 'ru' ? 'Недостаточно прав' : 'Insufficient Permissions')
                                .setDescription(
                                    lang === 'ru'
                                        ? 'У бота нет нужных прав в этом канале (ViewChannel, SendMessages, EmbedLinks).'
                                        : 'The bot does not have required permissions in this channel (ViewChannel, SendMessages, EmbedLinks).'
                                )
                                .setColor('#d9534f')
                        ]
                    });
                }

                if (logRow && mode === 'enable') {
                    const embed = new EmbedBuilder()
                        .setTitle(lang === 'ru' ? 'Логи уже включены' : 'Logs Already Enabled')
                        .setDescription(
                            lang === 'ru'
                                ? 'На сервере уже активированы категории логов. Перед тем как включить общий лог-канал, необходимо отключить текущие категории. Нажмите кнопку ниже чтобы отключить их автоматически.'
                                : 'Categories are already enabled on this server. You must disable them before enabling the general log channel. Use the button below to disable them automatically.'
                        )
                        .setColor('#d9534f')
                        .setThumbnail(client.user.displayAvatarURL({ dynamic: true }))

                    const row = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId('disable_categories')
                            .setLabel(lang === 'ru' ? 'Отключить' : 'Disable')
                            .setStyle(ButtonStyle.Danger)
                    );

                    return interaction.editReply({ embeds: [embed], components: [row] });
                }

                if (mode === 'enable') {
                    dbLogs.run(`
                        INSERT OR REPLACE INTO logs_settings 
                        (guildID, channelID, channelName, guildName, authorName, authorID)
                        VALUES (?, ?, ?, ?, ?, ?)
                    `,
                    [guildID, channel.id, channel.name, guildName, authorName, authorID],
                    async err => {
                        if (err) {
                            console.error(err);
                            return interaction.editReply({ content: 'Ошибка базы данных.' });
                        }

                        const embed = new EmbedBuilder()
                            .setTitle(lang === 'ru' ? 'Логи включены' : 'Logs Enabled')
                            .setDescription(
                                lang === 'ru'
                                    ? `Логи сервера будут отправляться в канал ${channel}.`
                                    : `Server logs will be sent to ${channel}.`
                            )
                            .setThumbnail(client.user.displayAvatarURL({ dynamic: true }))
                            .setColor('#fe983e');

                        await interaction.editReply({ embeds: [embed] });
                        dbLogs.close();
                    });

                    return;
                }

                if (mode === 'disable') {
                    dbLogs.run(`DELETE FROM logs_settings WHERE guildID = ?`, [guildID], async err => {
                        if (err) {
                            console.error(err);
                            return interaction.editReply({ content: 'Ошибка базы данных.' });
                        }

                        const embed = new EmbedBuilder()
                            .setTitle(lang === 'ru' ? 'Логи отключены' : 'Logs Disabled')
                            .setDescription(
                                lang === 'ru'
                                    ? 'Настройки логов удалены.'
                                    : 'Log settings removed.'
                            )
                            .setThumbnail(client.user.displayAvatarURL({ dynamic: true }))
                            .setColor('#fe983e');

                        await interaction.editReply({ embeds: [embed] });
                        dbLogs.close();
                    });

                    return;
                }
            }
        );
    }
};
