const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const os = require('os');
const { getLogGuildsCount } = require('../events/serverscount');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('info')
        .setDescription('Показать информацию о боте'),

    async execute(interaction, client, { getGuildLang, getFormattedStats, incrementCommandsHandled }) {
        try {
            if (!interaction.isChatInputCommand()) return;

            if (!interaction.deferred && !interaction.replied) {
                await interaction.deferReply();
            }

            const guildId = interaction.guild?.id;

            const formatUptime = (uptimeMs) => {
                const totalSeconds = Math.floor(uptimeMs / 1000);
                const hours = Math.floor(totalSeconds / 3600).toString().padStart(2, '0');
                const minutes = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, '0');
                const seconds = (totalSeconds % 60).toString().padStart(2, '0');
                return `${hours}:${minutes}:${seconds}`;
            };

            const formatNum = (num) => {
                if (num === undefined || num === null) return '0';
                return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
            };

            const [
                logGuildsCount,
                lang,
                stats
            ] = await Promise.all([
                getLogGuildsCount(),
                guildId ? getGuildLang(guildId) : 'ru',
                getFormattedStats()
            ]);

            const totalGuilds = client.guilds.cache.size;
            const usersCount = client.guilds.cache.reduce((sum, g) => sum + (g.memberCount || 0), 0);
            const uptime = formatUptime(client.uptime);
            const ping = Math.round(client.ws.ping);

            if (interaction.guild && await client.isGuildBanned(interaction.guild.id)) {
                const errorEmbed = new EmbedBuilder()
                    .setTitle(lang === 'ru' ? 'Доступ запрещён' : 'Access Denied')
                    .setDescription(
                        lang === 'ru'
                            ? 'Этот сервер заблокирован для использования бота! Если вы считаете это ошибкой, обратитесь в поддержку.'
                            : 'This server is banned from using the bot! If you believe this is a mistake, contact support.'
                    )
                    .setColor('#fe983e');

                return interaction.editReply({ embeds: [errorEmbed] });
            }

            if (await client.isUserBanned(interaction.user.id)) {
                const errorEmbed = new EmbedBuilder()
                    .setTitle(lang === 'ru' ? 'Доступ запрещён' : 'Access Denied')
                    .setDescription(
                        lang === 'ru'
                            ? 'Вы заблокированы для использования бота! Если вы считаете это ошибкой, обратитесь в поддержку.'
                            : 'You are banned from using the bot! If you believe this is a mistake, contact support.'
                    )
                    .setColor('#fe983e');

                return interaction.editReply({ embeds: [errorEmbed] });
            }

            incrementCommandsHandled();

            const cpus = os.cpus();
            let totalIdle = 0, totalTick = 0;

            cpus.forEach(cpu => {
                for (const type in cpu.times) {
                    totalTick += cpu.times[type];
                }
                totalIdle += cpu.times.idle;
            });

            const cpuUsage = 100 - ((totalIdle / totalTick) * 100);
            const totalMem = os.totalmem();
            const freeMem = os.freemem();
            const ramUsage = ((totalMem - freeMem) / totalMem * 100);
            const overallLoad = ((cpuUsage + ramUsage) / 2).toFixed(2);

            const versionBot = "v0.1.21.7";

            const embed = new EmbedBuilder()
                .setTitle(lang === 'ru' ? 'Информация о боте' : 'Bot Information')
                .addFields(
                    {
                        name: lang === 'ru' ? 'Общее:' : 'General:',
                        value: `- ${lang === 'ru' ? 'Серверы' : 'Servers'}: ${formatNum(logGuildsCount)}/${formatNum(totalGuilds)}
- ${lang === 'ru' ? 'Пользователи' : 'Users'}: ${formatNum(usersCount)}
- ${lang === 'ru' ? 'Нагрузка' : 'Load'}: ${overallLoad}%

**${lang === 'ru' ? 'Статистика' : 'Statistics'}**
- Ping: ${ping}ms
- ${lang === 'ru' ? 'Отправлено логов' : 'Logs sent'}: ${formatNum(stats.formattedLogHandled)}
- ${lang === 'ru' ? 'Обработано команд' : 'Commands handled'}: ${formatNum(stats.formattedCommandsHandled)}
- ${lang === 'ru' ? 'Бот работает' : 'Bot uptime'}: ${uptime}`,
                        inline: true
                    },
                    {
                        name: lang === 'ru' ? 'Инфо:' : 'Info:',
                        value: `- ${lang === 'ru' ? 'Версия' : 'Version'}: ${versionBot}
- ${lang === 'ru' ? 'Язык' : 'Language'}: ${lang}

**${lang === 'ru' ? 'Ссылки' : 'Links'}**
- ${lang === 'ru' ? 'Поддержка' : 'Support'}: [${lang === 'ru' ? 'Ссылка' : 'Link'}](https://discord.gg/)`,
                        inline: true
                    }
                )
                .setColor('#fe983e')
                .setThumbnail(client.user.displayAvatarURL({ dynamic: true, size: 256 }));

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Ошибка в команде info:', error);
            if (client.sendErrorEmbed) {
                await client.sendErrorEmbed(error, interaction);
            }
        }
    }
};
