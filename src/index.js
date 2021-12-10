const dotenv = require('dotenv');
const No2tg = require('./No2tg');
const { Command } = require('commander');
const Day = require('dayjs');
const Shell = require('shelljs');

dotenv.config();

const program = new Command();
program
  .option('-i, --id <PageId>', 'Publishing PageId.')
  .option('-d, --day <Day>', 'Publishing Day.')
  .parse(process.argv);
const cliOptions = program.opts();

/**
 * 主进程入口
 */
async function run() {
  if (process.env.NO2TG_PROXY) await initProxy();

  const no2tg = new No2tg({
    databaseId: process.env.NOTION_DATABASE_ID,
    notionAuthKey: process.env.NOTION_AUTH_KEY,
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
    telegramChatId: process.env.TELEGRAM_CHAT_ID,
  });

  // 根据 ID 发送
  if (cliOptions.id) {
    no2tg.sendById(cliOptions.id);
  }
  // 根据指定日期发送
  else if (cliOptions.day) {
    no2tg.sendByDay(cliOptions.day);
  }
  // 默认情况
  else {
    no2tg.sendByDay(Day().format('YYYY-MM-DD'));
  }
}

/**
 * 为执行上下文添加代理
 */
async function initProxy() {
  let proxyAddress;

  // 如果直接提供了代理路径
  if (process.env.NO2TG_PROXY_ADDRESS) {
    proxyAddress = process.env.NO2TG_PROXY_ADDRESS;
  }

  // 如果在 WSL 环境
  if (process.env.NO2TH_PROXY_AT_WSL) {
    const { stdout  } = Shell.exec(`cat /etc/resolv.conf | grep nameserver | awk '{ print $2 }'`);
    const hostIP = stdout.trim();
    const port = process.env.NO2TH_PROXY_AT_WSL_PORT;
    proxyAddress = `http://${hostIP}:${port}`;
  }

  Shell.env.http_proxy = proxyAddress;
  Shell.env.https_proxy = proxyAddress;
}

run();
