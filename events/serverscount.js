const sqlite3 = require('sqlite3');
const path = require('path');

function getLogGuildsCount() {
    return new Promise((resolve, reject) => {
        const dbLogs = new sqlite3.Database(path.join(__dirname, '../db/logs.db'), sqlite3.OPEN_READONLY);
        const dbSettings = new sqlite3.Database(path.join(__dirname, '../db/settings.db'), sqlite3.OPEN_READONLY);

        const uniqueServers = new Set();

        dbLogs.all(`SELECT DISTINCT guildID FROM logs_settings`, [], (err, rowsLogs) => {
            if (err) {
                dbLogs.close();
                dbSettings.close();
                return reject(err);
            }

            rowsLogs.forEach(r => uniqueServers.add(String(r.guildID)));

            dbSettings.all(`SELECT DISTINCT server_id FROM logs WHERE enabled = 1`, [], (err2, rowsSettings) => {
                if (err2) {
                    dbLogs.close();
                    dbSettings.close();
                    return reject(err2);
                }

                rowsSettings.forEach(r => uniqueServers.add(String(r.server_id)));

                dbLogs.close();
                dbSettings.close();

                resolve(uniqueServers.size);
            });
        });
    });
}

module.exports = { getLogGuildsCount };
