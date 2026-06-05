const { spawn } = require("child_process");

const bots = [
  ["index.js"],
  ["status.js"]
];


const RESTART_INTERVAL = 1 * 60 * 60 * 1000;

function startBot(file) {
  let child = spawn("node", [file], { stdio: "inherit" });

  console.log(`${file} запущен`);

  const restartTimer = setTimeout(() => {
    console.log(`${file} рестарт по таймеру`);
    child.kill("SIGTERM");
  }, RESTART_INTERVAL);

  child.on("exit", (code, signal) => {
    clearTimeout(restartTimer);

    if (signal) {
      console.log(`${file} убит сигналом ${signal}. Перезапуск...`);
      return setTimeout(() => startBot(file), 1000);
    }

    if (code !== 0) {
      console.log(`${file} упал с кодом ${code}. Перезапуск...`);
      return setTimeout(() => startBot(file), 1000);
    }

    if (code === 2) {
      console.log(`${file} ошибка 2 (без доступа к файлу). Не перезапускаю.`);
      return;
    }
  });

  child.on("error", (err) => {
    clearTimeout(restartTimer);

    if (String(err).includes("409")) {
      console.error(`${file} ошибка 409 (бот уже запущен). Не перезапускаю.`);
      return;
    }

    console.error(`${file} получил ошибку:`, err);
    setTimeout(() => startBot(file), 1000);
  });
}

bots.forEach((file) => startBot(file[0]));
