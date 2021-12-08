const { Client } = require('@notionhq/client');
const dotenv = require('dotenv');
const Day = require('dayjs');
const Axios = require('axios');
const Shell = require('shelljs');
const HttpsProxyAgent = require('https-proxy-agent');

dotenv.config();

class No2tg {
  constructor() {}

  async init() {
    await this.initNotion();
    await this.initHttp();
  }

  async initNotion() {
    const hostIP = await this._getHostIP();

    this.notion = new Client({
      auth: process.env.NOTION_KEY,
      agent: new HttpsProxyAgent(`http://${hostIP}:7890`),
    });
    this.databaseId = process.env.NOTION_DATABASE_ID;
  }

  async initHttp() {
    const hostIP = await this._getHostIP();

    this.http = Axios.create({
      baseURL: `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`,
      headers: { 'Content-Type': 'application/json' },
      proxy: {
        protocol: 'http',
        host: hostIP,
        port: 7890,
      },
    });

    this.http.interceptors.request.use((config) => {
      // console.log('HTTP CONFIG DATA:', config.data);
      return config;
    });

    this.http.interceptors.response.use(
      (res) => res,
      (err) => {
        console.log('HTTP ERROR');
        console.log(err);
        return Promise.reject(err.response);
      }
    );
  }

  async sendTodayUpdates() {
    const res = await this.notion.databases.query({
      database_id: this.databaseId,
      filter: {
        property: 'PlanningPublish',
        date: { equals: Day().format('YYYY-MM-DD') },
      },
    });

    console.log('sendTodayUpdates: Query successful');

    res.results.forEach((result) => this.sendToTelegram(result));
  }

  async sendToTelegram(pageCtx) {
    const _category = pageCtx.properties.Category.select.name;
    const categoryBuilderMap = {
      镇站之宝: this.buildBilibiliVideoCtx,
    };

    if (!categoryBuilderMap[_category]) {
      console.error('No category builder found for category:', _category);
      return;
    }

    const _covers = this._buildCovers(pageCtx);
    console.log(_covers);

    const _tags = this._buildTags(pageCtx);
    console.log(_tags);

    const pageBlocks = await this.notion.blocks.children.list({ block_id: pageCtx.id });
    const _contentText = categoryBuilderMap[_category].call(this, pageCtx, pageBlocks.results);

    const finalText = `${_tags}\n\n${_contentText}\n\n频道：@AboutZY`
      .trim()
      .replaceAll(`+`, `\\+`)
      .replaceAll(`-`, `\\-`);

    console.log(finalText);

    await this.http({
      url: '/sendPhoto',
      method: 'POST',
      data: {
        chat_id: process.env.TELEGRAM_CHAT_ID,
        parse_mode: 'MarkdownV2',
        photo: _covers[0],
        caption: finalText,
      },
    });

    console.log('Sent!');
  }

  /**
   * category: 镇站之宝
   */
  buildBilibiliVideoCtx(pageCtx, pageBlocks) {
    const _meta = [];
    _meta.push(pageCtx.properties.Original.checkbox ? '👩‍💻 原创：' + '✅' : '❌');
    if (pageCtx.properties.Original.checkbox)
      _meta.push(
        `🆙 UP：${this._buildLink(
          pageCtx.properties.UP.rich_text[0].plain_text,
          pageCtx.properties.UPLink.url
        )}`
      );
    _meta.push(`📆 发布时间：${this._formatDate(pageCtx.properties.VideoPubDate.date.start)}`);
    const meta = _meta.join('\n');

    return `${this._buildTitle(pageCtx)}

${meta}

${this._translateBlocks(pageBlocks)}`;
  }

  /**
   * 构建链接
   */
  _buildLink(label, link) {
    return `[${label}](${link})`;
  }

  /**
   * 构建标题
   */
  _buildTitle(pageCtx) {
    const plainTextTitle = pageCtx.properties.Name.title[0].plain_text;
    const title = pageCtx.properties.BiliVideoLink.url
      ? this._buildLink(plainTextTitle, pageCtx.properties.BiliVideoLink.url)
      : plainTextTitle;
    const emoji = pageCtx.icon?.emoji;

    return emoji ? emoji + ' ' + title : title;
  }

  /**
   * 构建标签
   */
  _buildTags(pageCtx) {
    const category = pageCtx.properties.Category.select.name;
    const tags = pageCtx.properties.Tags.multi_select.map((tag) => tag.name);

    return [category, ...tags].map((tag) => `\\#${tag}`).join(' ');
  }

  /**
   * 封面
   */
  _buildCovers(pageCtx) {
    const covers = pageCtx.properties.Cover.files.map((cover) => cover.file.url);

    return covers;
  }

  /**
   * 格式化时间
   */
  _formatDate(date) {
    return Day(date).format('YYYY-MM-DD');
  }

  /**
   * 格式化文本内容
   */
  _translateBlocks(pageBlocks) {
    return pageBlocks
      .filter((block) => block.paragraph.text.length)
      .map((block) => {
        return block.paragraph.text
          .map((part) => {
            let thisPart = '';

            // 如果文本是代码
            if (part.annotations.code) {
              thisPart = '`' + part.plain_text + '`';
            }
            // 链接，加粗，斜体，删除线，下划线可共存
            else {
              thisPart = part.href ? `[${part.plain_text}](${part.href})` : part.plain_text;
              if (part.annotations.bold) {
                thisPart = `*${thisPart}*`;
              }
              if (part.annotations.italic) {
                thisPart = `_${thisPart}_`;
              }
              if (part.annotations.underline) {
                thisPart = `__${thisPart}__`;
              }
              if (part.annotations.strikethrough) {
                thisPart = `~${thisPart}~`;
              }
            }

            return thisPart;
          })
          .join('');
      })
      .join('\n')
      .trim();
  }

  async _getHostIP() {
    return new Promise((resolve) => {
      const child = Shell.exec(`cat /etc/resolv.conf | grep nameserver | awk '{ print $2 }'`, {
        async: true,
      });
      child.stdout.on('data', (data) => {
        resolve(data.trim());
      });
    });
  }
}

(async () => {
  const no2tg = new No2tg();
  await no2tg.init();
  no2tg.sendTodayUpdates();
})();
