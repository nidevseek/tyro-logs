const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('lang')
        .setDescription('Изменить язык бота на сервере')
        .addStringOption(option =>
            option.setName('язык')
                  .setDescription('Выберите язык')
                  .setRequired(true)
                  .addChoices(
                      { name: 'Русский', value: 'ru' },
                      { name: 'English', value: 'en' }
                  )
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

        async execute(interaction, client, { getGuildLang, incrementCommandsHandled } ) {
        if (!interaction || typeof interaction.isChatInputCommand !== 'function' || !interaction.isChatInputCommand()) return;

        incrementCommandsHandled();

        const guildId = interaction.guild.id;
        const newLang = interaction.options.getString('язык');
        const lang = await getGuildLang(guildId);
        const serverName = interaction.guild.name;

        if (await client.isGuildBanned(interaction.guild.id)) {
            return interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle(lang === 'ru' ? 'Доступ запрещён' : 'Access Denied')
                        .setDescription(
                            lang === 'ru'
                        ? 'Этот сервер заблокирован для использования бота! Если вы считаете это ошибкой, обратитесь в [поддержку](https://discord.gg/)'
                        : 'This server is banned from using the bot! If you believe this is a mistake, contact [support](https://discord.gg/)'
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

        try {
            const currentLang = await getGuildLang(guildId);

            if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                const embed = new EmbedBuilder()
                    .setTitle(currentLang === 'ru' ? 'Ошибка!' : 'Error!')
                    .setDescription(currentLang === 'ru'
                        ? 'Для установки языка нужны права администратора!'
                        : 'You need administrator rights to set up the language!')
                    .setColor('#FF0000');
                return interaction.editReply({ embeds: [embed] });
            }

            if (currentLang === newLang) {
                const embed = new EmbedBuilder()
                    .setTitle(currentLang === 'ru' ? 'Ошибка!' : 'Error!')
                    .setDescription(currentLang === 'ru'
                        ? 'Текущий язык уже установлен!'
                        : 'The current language is already set!')
                    .setColor('#FF0000');
                return interaction.editReply({ embeds: [embed] });
            }

            client.dbLang.run(
                `INSERT INTO guilds (guildID, guildName, lang) 
                 VALUES (?, ?, ?)
                 ON CONFLICT(guildID) DO UPDATE SET lang = ?`,
                [guildId, serverName, newLang, newLang],
                (err) => { if (err) console.error(err); }
            );

            const embed = new EmbedBuilder()
                .setTitle(newLang === 'ru' ? 'Язык изменён!' : 'Language changed!')
                .setDescription(newLang === 'ru'
                    ? `Язык бота на сервере был изменён на Русский`
                    : `The language of the bot on the server has been changed to English`)
                .setColor('#fe983e');

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Ошибка в команде lang', error);
            const lang = await getGuildLang(guildId) || 'ru';
            const embed = new EmbedBuilder()
                .setTitle(lang === 'ru' ? 'Ошибка!' : 'Error!')
                .setDescription(lang === 'ru'
                    ? 'Произошла ошибка при смене языка!'
                    : 'There was an error when changing the language!')
                .setColor('#FF0000');

            await interaction.editReply({ embeds: [embed] });
        }
    }
};

