const { 
ModalBuilder, TextInputStyle, PermissionsBitField, PermissionFlagsBits, EmbedBuilder, 
ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, TextInputBuilder, ChannelType,
MessageFlags, LabelBuilder, StringSelectMenuOptionBuilder
} = require('discord.js');
const sqlite3 = require('sqlite3');

function createEmbed(title, description, color = '#fe983e', interaction) {
    const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(color);

    const thumbnailURL = interaction?.guild?.iconURL({ dynamic: true, size: 256 }) || interaction?.client?.user?.displayAvatarURL({ dynamic: true, size: 256 });
    if (thumbnailURL) embed.setThumbnail(thumbnailURL);

    return embed;
}

const categories = [
    { 
        key: 'Войсы', 
        name: lang => lang === 'ru' ? 'Войсы' : 'Voice Channels', 
        emoji: '🎤',
        description: lang => lang === 'ru' 
            ? 'Подключение/отключение, переходы между голосовыми каналами' 
            : 'Connect/disconnect, moving between voice channels'
    },
    { 
        key: 'Каналы', 
        name: lang => lang === 'ru' ? 'Каналы' : 'Channels', 
        emoji: '📝',
        description: lang => lang === 'ru' 
            ? 'Создание, удаление, обновление каналов и разрешений' 
            : 'Create, delete, update channels and permissions'
    },
    { 
        key: 'Сообщения', 
        name: lang => lang === 'ru' ? 'Сообщения' : 'Messages', 
        emoji: '📋',
        description: lang => lang === 'ru' 
            ? 'Удаление и редактирование сообщений, архивация' 
            : 'Message delete, edit, archive'
    },
    { 
        key: 'Роли', 
        name: lang => lang === 'ru' ? 'Роли' : 'Roles', 
        emoji: '👥',
        description: lang => lang === 'ru' 
            ? 'Создание, обновление, удаление ролей, назначение ролей' 
            : 'Create, update, delete roles, role assignments'
    },
    { 
        key: 'Эмодзи и стикеры', 
        name: lang => lang === 'ru' ? 'Эмодзи и стикеры' : 'Emojis & Stickers', 
        emoji: '😀',
        description: lang => lang === 'ru' 
            ? 'Добавление и удаление эмодзи и стикеров' 
            : 'Add and remove emojis and stickers'
    },
    { 
        key: 'Реакции', 
        name: lang => lang === 'ru' ? 'Реакции' : 'Reactions', 
        emoji: '✅',
        description: lang => lang === 'ru' 
            ? 'Добавление и удаление реакций на сообщения' 
            : 'Add and remove message reactions'
    },
    { 
        key: 'Треды', 
        name: lang => lang === 'ru' ? 'Треды' : 'Threads', 
        emoji: '🧵',
        description: lang => lang === 'ru' 
            ? 'Создание, удаление, обновление тредов' 
            : 'Create, delete, update threads'
    },
    { 
        key: 'Участники', 
        name: lang => lang === 'ru' ? 'Участники' : 'Members', 
        emoji: '👤',
        description: lang => lang === 'ru' 
            ? 'Вход/выход, бан/разбан, мут, смена никнейма, роли' 
            : 'Join/leave, ban/unban, mute, nickname change, roles'
    },
    { 
        key: 'Сервер', 
        name: lang => lang === 'ru' ? 'Сервер' : 'Server', 
        emoji: '🏰',
        description: lang => lang === 'ru' 
            ? 'Обновление настроек сервера, интеграции, боты' 
            : 'Server settings update, integrations, bots'
    },
    { 
        key: 'Вебхуки', 
        name: lang => lang === 'ru' ? 'Вебхуки' : 'Webhook', 
        emoji: '🗯️',
        description: lang => lang === 'ru' 
            ? 'Создание, удаление, обновление вебхуков' 
            : 'Create, delete, update webhooks'
    },
    { 
        key: 'Инвайты', 
        name: lang => lang === 'ru' ? 'Инвайты' : 'Invites', 
        emoji: '🔗',
        description: lang => lang === 'ru' 
            ? 'Создание и удаление приглашений на сервер' 
            : 'Create and remove server invites'
    },
    { 
        key: 'Эвенты', 
        name: lang => lang === 'ru' ? 'Эвенты' : 'Events', 
        emoji: '📅',
        description: lang => lang === 'ru' 
            ? 'Создание, обновление, удаление событий сервера и Stage-сессий' 
            : 'Create, update, delete server events and Stage instances'
    },
    { 
        key: 'Автомодерация', 
        name: lang => lang === 'ru' ? 'Автомодерация' : 'Automoderation', 
        emoji: '⚙️',
        description: lang => lang === 'ru' 
            ? 'Правила автомодерации, блокировки, фильтрация контента' 
            : 'AutoMod rules, block messages, content filtering'
    }
];

module.exports = {
    name: 'interactionCreate',
    async execute(interaction, client, deps) {
        try {
            const getGuildLang = (deps && deps.getGuildLang) ? deps.getGuildLang : (client && client.getGuildLang) ? client.getGuildLang : null;
            if (!getGuildLang) return;
            if (!interaction.isButton() && !interaction.isStringSelectMenu() && !interaction.isModalSubmit()) return;
            if (!interaction.guild && !interaction.isModalSubmit()) return;

            const db = new sqlite3.Database('./db/settings.db');
            const guildID = interaction.guild?.id;
            if (!guildID && !interaction.isModalSubmit()) return;
            const lang = await getGuildLang(guildID);
            const id = interaction.customId || interaction.custom_id;

            if (!id) return;

            if (interaction.isButton() && id === 'disable_categories') {
                if (!interaction.member?.permissions?.has(PermissionsBitField.Flags.Administrator)) {
                    return interaction.reply({ 
                        embeds: [createEmbed(lang === 'ru' ? 'Ошибка доступа' : 'Access Error', lang === 'ru' ? '❌ У вас нет прав администратора.' : '❌ You do not have administrator permissions.', '#ff0000', interaction)], 
                        ephemeral: true
                    });
                }
                db.run(`DELETE FROM logs WHERE server_id = ?`, [guildID], err => {
                    if (err) {
                    return interaction.reply({
                        embeds: [createEmbed(lang === 'ru' ? 'Ошибка' : 'Error', 'Не удалось отключить категории.', '#ff0000', interaction)],
                        ephemeral: true
                    });
                    }

                    return interaction.reply({
                        embeds: [createEmbed(lang === 'ru' ? 'Отключено' : 'Disabled', 'Все категории логов отключены. Теперь можно включить общий лог.', '#2ecc71', interaction)],
                        ephemeral: true
                    });
                });
                return;
            }
            
            if (id === 'clear_settings_logs') {
                if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                    return interaction.reply({ 
                        embeds: [createEmbed(lang === 'ru' ? 'Ошибка доступа' : 'Access Error', lang === 'ru' ? '❌ У вас нет прав администратора.' : '❌ You do not have administrator permissions.', '#ff0000', interaction)], 
                        ephemeral: true
                    });
                }
                db.run(`DELETE FROM logs`, err => {
                    if (err) return interaction.reply({ embeds: [createEmbed(lang === 'ru' ? 'Ошибка' : 'Error', lang === 'ru' ? 'Не удалось очистить логи.' : 'Failed to clear logs.', '#d11a1a', interaction)], flags: MessageFlags.Ephemeral });
                    return interaction.reply({ embeds: [createEmbed(lang === 'ru' ? 'Готово' : 'Done', lang === 'ru' ? 'Все логи успешно отключены.' : 'All logs have been successfully disabled.', '#2ecc71', interaction)], flags: MessageFlags.Ephemeral });
                });
                return;
            }

            if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                return interaction.reply({ 
                    embeds: [createEmbed(lang === 'ru' ? 'Ошибка доступа' : 'Access Error', lang === 'ru' ? '❌ У вас нет прав администратора.' : '❌ You do not have administrator permissions.', '#ff0000', interaction)], 
                    ephemeral: true
                });
            }

            db.run(`CREATE TABLE IF NOT EXISTS logs (
                server_id TEXT,
                server_name TEXT,
                category TEXT,
                channel_id TEXT,
                channel_name TEXT,
                enabled INTEGER,
                mode TEXT,
                webhook_url TEXT,
                PRIMARY KEY (server_id, category)
            )`);

            if (interaction.isButton() && id === 'setup_logs_new') {
            const botMember = interaction.guild.members.me || await interaction.guild.members.fetchMe().catch(() => null);
            if (!botMember) {
                return interaction.reply({
                    embeds: [createEmbed(
                        lang === 'ru' ? 'Ошибка' : 'Error',
                        lang === 'ru' ? 'Не удалось получить информацию о боте.' : 'Failed to get bot information.',
                        '#ff0000',
                        interaction
                    )],
                    flags: MessageFlags.Ephemeral
                });
            }

            db.all(`SELECT channel_id FROM log_ignored_channels WHERE server_id = ?`, [guildID], (errIgnored, ignoredRows) => {
                const ignoredIds = (errIgnored || !ignoredRows) ? [] : ignoredRows.map(r => r.channel_id);
                const textChannels = interaction.guild.channels.cache
                    .filter(ch => {
                        if (ch.type !== ChannelType.GuildText) return false;
                        if (ignoredIds.includes(ch.id)) return false;
                        const perms = ch.permissionsFor(botMember);
                        return perms && perms.has(PermissionsBitField.Flags.SendMessages);
                    })
                    .map(ch => ({ id: ch.id, name: ch.name }))
                    .slice(0, 25)
                    .sort((a, b) => a.name.localeCompare(b.name));

                if (textChannels.length === 0) {
                    return interaction.reply({
                        embeds: [createEmbed(
                            lang === 'ru' ? 'Ошибка' : 'Error',
                            lang === 'ru' ? 'Нет доступных каналов для логов (возможно, все в списке игнорируемых).' : 'No channels available for logs (all may be ignored).',
                            '#ff0000',
                            interaction
                        )],
                        flags: MessageFlags.Ephemeral
                    });
                }

                const channelSelect = new StringSelectMenuBuilder()
                .setCustomId('modal_channel_select')
                .setPlaceholder(lang === 'ru' ? 'Выберите канал' : 'Select channel')
                .setRequired(true)
                .addOptions(textChannels.map(ch => 
                    new StringSelectMenuOptionBuilder()
                        .setLabel(ch.name.length > 100 ? ch.name.substring(0, 97) + '...' : ch.name)
                        .setValue(ch.id)
                        .setDescription(lang === 'ru' ? `ID: ${ch.id}` : `ID: ${ch.id}`)
                ));

            const categorySelect = new StringSelectMenuBuilder()
                .setCustomId('modal_category_select')
                .setPlaceholder(lang === 'ru' ? 'Выберите категорию' : 'Select category')
                .setRequired(true)
                .addOptions(categories.map(cat => 
                    new StringSelectMenuOptionBuilder()
                        .setLabel(cat.name(lang))
                        .setValue(cat.key)
                        .setDescription(cat.description(lang).length > 100 
                            ? cat.description(lang).substring(0, 97) + '...' 
                            : cat.description(lang))
                ));

            const modeSelect = new StringSelectMenuBuilder()
                .setCustomId('modal_mode_select')
                .setPlaceholder(lang === 'ru' ? 'Выберите режим' : 'Select mode')
                .setRequired(true)
                .addOptions([
                    new StringSelectMenuOptionBuilder()
                        .setLabel(lang === 'ru' ? 'Embed' : 'Embed')
                        .setValue('embed'),
                    new StringSelectMenuOptionBuilder()
                        .setLabel(lang === 'ru' ? 'Webhook' : 'Webhook')
                        .setValue('webhook')
                ]);

            const enabledSelect = new StringSelectMenuBuilder()
                .setCustomId('modal_enabled_select')
                .setPlaceholder(lang === 'ru' ? 'Включить или выключить' : 'Enable or disable')
                .setRequired(true)
                .addOptions([
                    new StringSelectMenuOptionBuilder()
                        .setLabel(lang === 'ru' ? 'Включить' : 'Enable')
                        .setValue('1'),
                    new StringSelectMenuOptionBuilder()
                        .setLabel(lang === 'ru' ? 'Выключить' : 'Disable')
                        .setValue('0')
                ]);

            const channelLabel = new LabelBuilder()
                .setLabel(lang === 'ru' ? 'Канал' : 'Channel')
                .setDescription(lang === 'ru' ? 'Выберите канал, в который будут отправляться логи' : 'Select the channel where logs will be sent')
                .setStringSelectMenuComponent(channelSelect);

            const categoryLabel = new LabelBuilder()
                .setLabel(lang === 'ru' ? 'Категория' : 'Log Category')
                .setStringSelectMenuComponent(categorySelect);

            const modeLabel = new LabelBuilder()
                .setLabel(lang === 'ru' ? 'Режим' : 'Mode')
                .setStringSelectMenuComponent(modeSelect);

            const enabledLabel = new LabelBuilder()
                .setLabel(lang === 'ru' ? 'Состояние' : 'State')
                .setDescription(lang === 'ru' ? 'Включить или выключить логи для категории' : 'Enable or disable logs for this category')
                .setStringSelectMenuComponent(enabledSelect);

            const modal = new ModalBuilder()
                .setCustomId('setup_logs_modal')
                .setTitle(lang === 'ru' ? 'Настройка' : 'Logs Setup')
                .addLabelComponents(channelLabel, categoryLabel, modeLabel, enabledLabel);

                return interaction.showModal(modal);
            });
            }

        if (interaction.isButton() && id === 'setup_ignored_channels') {
            db.run(`CREATE TABLE IF NOT EXISTS log_ignored_channels (server_id TEXT, channel_id TEXT, PRIMARY KEY(server_id, channel_id))`);

            const botMember = interaction.guild.members.me || await interaction.guild.members.fetchMe().catch(() => null);
            if (!botMember) {
                return interaction.reply({
                    embeds: [createEmbed(lang === 'ru' ? 'Ошибка' : 'Error', lang === 'ru' ? 'Не удалось получить информацию о боте.' : 'Failed to get bot information.', '#ff0000', interaction)],
                    flags: MessageFlags.Ephemeral
                });
            }

            const textChannels = interaction.guild.channels.cache
                .filter(ch => ch.type === ChannelType.GuildText || ch.type === ChannelType.GuildVoice || ch.type === ChannelType.GuildAnnouncement)
                .map(ch => ({ id: ch.id, name: ch.name }))
                .slice(0, 25)
                .sort((a, b) => a.name.localeCompare(b.name));

            if (textChannels.length === 0) {
                return interaction.reply({
                    embeds: [createEmbed(lang === 'ru' ? 'Ошибка' : 'Error', lang === 'ru' ? 'Нет доступных каналов.' : 'No channels available.', '#ff0000', interaction)],
                    flags: MessageFlags.Ephemeral
                });
            }

            const channelSelect = new StringSelectMenuBuilder()
                .setCustomId('ignored_channel_select')
                .setPlaceholder(lang === 'ru' ? 'Выберите канал' : 'Select channel')
                .setRequired(true)
                .addOptions(textChannels.map(ch =>
                    new StringSelectMenuOptionBuilder()
                        .setLabel(ch.name.length > 100 ? ch.name.substring(0, 97) + '...' : ch.name)
                        .setValue(ch.id)
                        .setDescription(`ID: ${ch.id}`)
                ));

            const actionSelect = new StringSelectMenuBuilder()
                .setCustomId('ignored_action_select')
                .setPlaceholder(lang === 'ru' ? 'Игнорировать или нет' : 'Ignore or not')
                .setRequired(true)
                .addOptions([
                    new StringSelectMenuOptionBuilder()
                        .setLabel(lang === 'ru' ? 'Игнорировать (не логировать изменения)' : 'Ignore (do not log changes)')
                        .setValue('ignore'),
                    new StringSelectMenuOptionBuilder()
                        .setLabel(lang === 'ru' ? 'Не игнорировать (логировать)' : 'Do not ignore (log)')
                        .setValue('unignore')
                ]);

            const channelLabel = new LabelBuilder()
                .setLabel(lang === 'ru' ? 'Канал' : 'Channel')
                .setDescription(lang === 'ru' ? 'Канал для добавления в список игнорируемых' : 'Channel to add to ignored list')
                .setStringSelectMenuComponent(channelSelect);

            const actionLabel = new LabelBuilder()
                .setLabel(lang === 'ru' ? 'Действие' : 'Action')
                .setStringSelectMenuComponent(actionSelect);

            const modal = new ModalBuilder()
                .setCustomId('ignored_channels_modal')
                .setTitle(lang === 'ru' ? 'Игнорируемые каналы' : 'Ignored Channels')
                .addLabelComponents(channelLabel, actionLabel);

            return interaction.showModal(modal);
        }

        if (interaction.isModalSubmit() && id === 'setup_logs_modal') {
            if (!interaction.guild) {
                return interaction.reply({
                    embeds: [createEmbed(
                        lang === 'ru' ? 'Ошибка' : 'Error',
                        lang === 'ru' ? 'Эта команда доступна только на сервере.' : 'This command is only available on a server.',
                        '#ff0000',
                        interaction
                    )],
                    flags: MessageFlags.Ephemeral
                });
            }

            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            let channelId, categoryKey, mode, enabled = 1;
            
            try {
                if (interaction.fields && typeof interaction.fields.getStringSelectValues === 'function') {
                    channelId = interaction.fields.getStringSelectValues('modal_channel_select')?.[0];
                    categoryKey = interaction.fields.getStringSelectValues('modal_category_select')?.[0];
                    mode = interaction.fields.getStringSelectValues('modal_mode_select')?.[0];
                    const enabledVal = interaction.fields.getStringSelectValues('modal_enabled_select')?.[0];
                    if (enabledVal !== undefined) enabled = parseInt(enabledVal, 10) ? 1 : 0;
                } else {
                    const components = interaction.data?.components || [];
                    for (const component of components) {
                        if (component.components) {
                            for (const comp of component.components) {
                                if (comp.custom_id === 'modal_channel_select' && comp.values) {
                                    channelId = comp.values[0];
                                } else if (comp.custom_id === 'modal_category_select' && comp.values) {
                                    categoryKey = comp.values[0];
                                } else if (comp.custom_id === 'modal_mode_select' && comp.values) {
                                    mode = comp.values[0];
                                } else if (comp.custom_id === 'modal_enabled_select' && comp.values) {
                                    enabled = parseInt(comp.values[0], 10) ? 1 : 0;
                                }
                            }
                        }
                    }
                }
            } catch (err) {
                console.error('Ошибка получения значений из модального окна:', err);
                console.error('interaction.fields методы:', Object.keys(interaction.fields || {}));
                return interaction.editReply({
                    embeds: [createEmbed(
                        lang === 'ru' ? 'Ошибка' : 'Error',
                        lang === 'ru' ? 'Не удалось получить данные из формы.' : 'Failed to get form data.',
                        '#ff0000',
                        interaction
                    )]
                });
            }
            
            if (!channelId || !categoryKey || !mode) {
                console.error('Не найдены значения:', { channelId, categoryKey, mode });
                return interaction.editReply({
                    embeds: [createEmbed(
                        lang === 'ru' ? 'Ошибка' : 'Error',
                        lang === 'ru' ? 'Не все поля были заполнены.' : 'Not all fields were filled.',
                        '#ff0000',
                        interaction
                    )]
                });
            }

            const channel = interaction.guild.channels.cache.get(channelId);

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

            db.get(`SELECT 1 FROM log_ignored_channels WHERE server_id = ? AND channel_id = ?`, [guildID, channelId], (errIgnore, rowIgnore) => {
                if (!errIgnore && rowIgnore) {
                    return interaction.editReply({
                        embeds: [createEmbed(
                            lang === 'ru' ? 'Нельзя добавить лог' : 'Cannot add log',
                            lang === 'ru'
                                ? `Канал <#${channelId}> в списке игнорируемых. Сначала уберите его из игнорируемых каналов (Настройки → Игнорируемые каналы → Не игнорировать).`
                                : `Channel <#${channelId}> is in the ignored list. Remove it from ignored channels first (Settings → Ignored channels → Do not ignore).`,
                            '#ff0000',
                            interaction
                        )]
                    });
                }
                runSetupLogsModalSubmit();
            });

            async function runSetupLogsModalSubmit() {
            const categoryObj = categories.find(c => c.key === categoryKey);
            let webhookUrl = null;

            if (mode === 'webhook') {
                try {
                    const ch = interaction.guild.channels.cache.get(channelId);
                    const webhooks = await ch.fetchWebhooks();
                    let webhook = webhooks.find(wh => wh.name === `Tyro Logs | ${categoryKey}`);
                    if (!webhook) {
                        webhook = await ch.createWebhook({
                            name: `Tyro Logs | ${categoryKey}`,
                            avatar: client.user.displayAvatarURL({ dynamic: true })
                        });
                    }
                    webhookUrl = webhook.url;
                } catch (err) {
                    console.error('Ошибка создания вебхука:', err);
                    return interaction.editReply({
                        embeds: [createEmbed(
                            lang === 'ru' ? 'Ошибка' : 'Error',
                            lang === 'ru' ? 'Не удалось создать вебхук. Проверьте права бота.' : 'Failed to create webhook. Check bot permissions.',
                            '#ff0000',
                            interaction
                        )]
                    });
                }
            }

            const channelName = channel.name || 'Unknown';

            db.run(`INSERT INTO logs (server_id, server_name, category, channel_id, channel_name, enabled, mode, webhook_url)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(server_id, category) DO UPDATE 
                    SET channel_id = ?, channel_name = ?, enabled = ?, mode = ?, webhook_url = ?`,
                [guildID, interaction.guild.name, categoryKey, channelId, channelName, enabled, mode, webhookUrl,
                 channelId, channelName, enabled, mode, webhookUrl],
                (err) => {
                    if (err) {
                        console.error('Ошибка БД:', err);
                        return interaction.editReply({
                            embeds: [createEmbed(
                                lang === 'ru' ? 'Ошибка' : 'Error',
                                lang === 'ru' ? 'Не удалось сохранить настройки.' : 'Failed to save settings.',
                                '#ff0000',
                                interaction
                            )]
                        });
                    }

                    const modeText = mode === 'embed' 
                        ? (lang === 'ru' ? 'Embed' : 'Embed')
                        : (lang === 'ru' ? 'Webhook' : 'Webhook');
                    const stateText = enabled ? (lang === 'ru' ? 'Включено' : 'Enabled') : (lang === 'ru' ? 'Выключено' : 'Disabled');

                    interaction.editReply({
                        embeds: [createEmbed(
                            lang === 'ru' ? 'Готово' : 'Done',
                            lang === 'ru'
                                ? `Категория: ${categoryObj?.name(lang)}\nКанал: <#${channelId}>\nРежим: ${modeText}\nСостояние: ${stateText}\n\nНастройки сохранены.`
                                : `Category: ${categoryObj?.name(lang)}\nChannel: <#${channelId}>\nMode: ${modeText}\nState: ${stateText}\n\nSettings saved.`,
                            '#fe983e',
                            interaction
                        )]
                    });
                }
            );
            }

            return;
        }

        if (interaction.isModalSubmit() && id === 'ignored_channels_modal') {
            if (!interaction.guild) {
                return interaction.reply({
                    embeds: [createEmbed(lang === 'ru' ? 'Ошибка' : 'Error', lang === 'ru' ? 'Доступно только на сервере.' : 'Available on server only.', '#ff0000', interaction)],
                    flags: MessageFlags.Ephemeral
                });
            }
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            let channelId, action;
            try {
                if (interaction.fields && typeof interaction.fields.getStringSelectValues === 'function') {
                    channelId = interaction.fields.getStringSelectValues('ignored_channel_select')?.[0];
                    action = interaction.fields.getStringSelectValues('ignored_action_select')?.[0];
                } else {
                    const rows = interaction.data?.components || [];
                    for (const row of rows) {
                        for (const c of row.components || []) {
                            if (c.custom_id === 'ignored_channel_select' && c.values) channelId = c.values[0];
                            if (c.custom_id === 'ignored_action_select' && c.values) action = c.values[0];
                        }
                    }
                }
            } catch (e) {
                return interaction.editReply({
                    embeds: [createEmbed(lang === 'ru' ? 'Ошибка' : 'Error', lang === 'ru' ? 'Не удалось получить данные.' : 'Failed to get data.', '#ff0000', interaction)]
                });
            }
            if (!channelId || !action) {
                return interaction.editReply({
                    embeds: [createEmbed(lang === 'ru' ? 'Ошибка' : 'Error', lang === 'ru' ? 'Заполните все поля.' : 'Fill all fields.', '#ff0000', interaction)]
                });
            }

            if (action === 'ignore') {
                db.get(`SELECT category FROM logs WHERE server_id = ? AND channel_id = ? LIMIT 1`, [guildID, channelId], (errLog, rowLog) => {
                    if (errLog) return interaction.editReply({ embeds: [createEmbed(lang === 'ru' ? 'Ошибка' : 'Error', 'DB error', '#ff0000', interaction)] });
                    if (rowLog) {
                        return interaction.editReply({
                            embeds: [createEmbed(
                                lang === 'ru' ? 'Нельзя игнорировать канал' : 'Cannot ignore channel',
                                lang === 'ru'
                                    ? `В канал <#${channelId}> уже пишутся логи (категория: ${rowLog.category}). Сначала перенастройте или выключите логи для этого канала.`
                                    : `Channel <#${channelId}> is used for logs (category: ${rowLog.category}). Change or disable logs for this channel first.`,
                                '#ff0000',
                                interaction
                            )]
                        });
                    }
                    db.run(`INSERT OR IGNORE INTO log_ignored_channels (server_id, channel_id) VALUES (?, ?)`, [guildID, channelId], (err) => {
                        if (err) return interaction.editReply({ embeds: [createEmbed(lang === 'ru' ? 'Ошибка' : 'Error', 'DB error', '#ff0000', interaction)] });
                        interaction.editReply({
                            embeds: [createEmbed(
                                lang === 'ru' ? 'Готово' : 'Done',
                                lang === 'ru' ? `Канал <#${channelId}> добавлен в список игнорируемых. Изменения этого канала не будут логироваться.` : `Channel <#${channelId}> added to ignored list. Its changes will not be logged.`,
                                '#2ecc71',
                                interaction
                            )]
                        });
                    });
                });
            } else {
                db.run(`DELETE FROM log_ignored_channels WHERE server_id = ? AND channel_id = ?`, [guildID, channelId], (err) => {
                    if (err) return interaction.editReply({ embeds: [createEmbed(lang === 'ru' ? 'Ошибка' : 'Error', 'DB error', '#ff0000', interaction)] });
                    interaction.editReply({
                        embeds: [createEmbed(
                            lang === 'ru' ? 'Готово' : 'Done',
                            lang === 'ru' ? `Канал <#${channelId}> убран из списка игнорируемых. Изменения снова будут логироваться.` : `Channel <#${channelId}> removed from ignored list. Changes will be logged again.`,
                            '#2ecc71',
                            interaction
                        )]
                    });
                });
            }
            return;
        }

        if (interaction.isButton() && id === 'setup_logs') {
            const buttons = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('choose_mode_embed').setLabel('Embed').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('choose_mode_webhook').setLabel('Webhook').setStyle(ButtonStyle.Secondary)
            );
            return interaction.reply({ embeds: [createEmbed(lang === 'ru' ? 'Выберите режим' : 'Select Mode', lang === 'ru' ? 'Выберите режим логов' : 'Select log mode', '#fe983e', interaction)], components: [buttons], flags: MessageFlags.Ephemeral });
        }

        if (interaction.isButton() && (id === 'choose_mode_embed' || id === 'choose_mode_webhook')) {
            const mode = id === 'choose_mode_embed' ? 'embed' : 'webhook';
            client.tempLogs = client.tempLogs || {};
            client.tempLogs[guildID] = { mode };

            const modal = new ModalBuilder()
                .setCustomId('setup_channel_modal')
                .setTitle(lang === 'ru' ? 'Введите ID канала' : 'Enter Channel ID')
                .addComponents(new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('channel_id_input')
                        .setLabel(lang === 'ru' ? 'ID канала' : 'Channel ID')
                        .setStyle(TextInputStyle.Short)
                        .setPlaceholder('123456789012345678')
                        .setRequired(true)
                ));
            return interaction.showModal(modal);
        }

        if (interaction.isModalSubmit() && interaction.customId === 'setup_channel_modal') {
            const channelId = interaction.fields.getTextInputValue('channel_id_input');
            const channel = interaction.guild.channels.cache.get(channelId);
            if (!channel || channel.type !== ChannelType.GuildText || !channel.permissionsFor(interaction.guild.members.me).has(PermissionsBitField.Flags.SendMessages))
                return interaction.reply({ embeds: [createEmbed(lang === 'ru' ? 'Ошибка канала' : 'Channel Error', lang === 'ru' ? 'Неверный канал' : 'Invalid channel', '#ff0000', interaction)], flags: MessageFlags.Ephemeral });

            client.tempLogs[guildID].channelId = channelId;

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('select_log_category')
                .setPlaceholder(lang === 'ru' ? 'Выберите категорию' : 'Select Category')
                .addOptions(categories.map(cat => ({ 
                    label: cat.name(lang), 
                    value: cat.key, 
                    emoji: cat.emoji,
                    description: cat.description(lang).length > 100 
                        ? cat.description(lang).substring(0, 97) + '...' 
                        : cat.description(lang)
                })));

            return interaction.reply({ embeds: [createEmbed(lang === 'ru' ? 'Выберите категорию' : 'Select Category', lang === 'ru' ? 'Выберите категорию для логов' : 'Select a category for logs', '#fe983e', interaction)], components: [new ActionRowBuilder().addComponents(selectMenu)], flags: MessageFlags.Ephemeral });
        }

        if (interaction.isStringSelectMenu() && interaction.customId === 'select_log_category') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const categoryKey = interaction.values[0];
            const { mode, channelId } = client.tempLogs[guildID];
            let webhookUrl = null;
        
            if (mode === 'webhook') {
                try {
                    const ch = interaction.guild.channels.cache.get(channelId);
                    const webhooks = await ch.fetchWebhooks();
                    let webhook = webhooks.find(wh => wh.name === `Tyro Logs | ${categoryKey}`);
                    if (!webhook) webhook = await ch.createWebhook({ name: `Tyro Logs | ${categoryKey}`, avatar: client.user.displayAvatarURL({ dynamic: true }) });
                    webhookUrl = webhook.url;
                } catch {
                    return interaction.editReply({ embeds: [createEmbed(lang === 'ru' ? 'Ошибка' : 'Error', lang === 'ru' ? 'Не удалось создать вебхук.' : 'Failed to create webhook.', '#ff0000', interaction)] });
                }
            }
        
            const channelName = interaction.guild.channels.cache.get(channelId)?.name || 'Unknown';
        
            db.run(`INSERT INTO logs (server_id, server_name, category, channel_id, channel_name, enabled, mode, webhook_url)
                    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
                    ON CONFLICT(server_id, category) DO UPDATE 
                    SET channel_id = ?, channel_name = ?, enabled = 1, mode = ?, webhook_url = ?`,
                [guildID, interaction.guild.name, categoryKey, channelId, channelName, mode, webhookUrl,
                 channelId, channelName, mode, webhookUrl],
                () => interaction.editReply({ embeds: [createEmbed(lang === 'ru' ? 'Готово' : 'Done', `Логи категории ${categoryKey} будут отправляться в режиме ${mode} в канал <#${channelId}>`, '#fe983e', interaction)] })
            );
            return;
        }
        } catch (error) {
            console.error('Ошибка в interactionCreate:', error);
            if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
                try {
                    await interaction.reply({
                        embeds: [createEmbed(
                            'Ошибка',
                            'Произошла ошибка при обработке взаимодействия.',
                            '#ff0000',
                            interaction
                        )],
                        ephemeral: true
                    });
                } catch (err) {
                    console.error('Не удалось отправить сообщение об ошибке:', err);
                }
            }
        }
    }        
};
