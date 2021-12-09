const { Client } = require('@notionhq/client');
const dotenv = require('dotenv');
const Day = require('dayjs');
const Axios = require('axios');
const Shell = require('shelljs');
const HttpsProxyAgent = require('https-proxy-agent');
const fs = require('fs');

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
        and: [
          {
            property: 'PlanningPublish',
            date: { equals: Day().format('YYYY-MM-DD') },
          },
          {
            property: 'Status',
            select: { equals: 'Completed' },
          },
        ],
      },
    });

    console.log('sendTodayUpdates: Query successful');

    // 每次发布第一个
    if (res.results.length) {
      const publishing = res.results[0];
      this.sendToTelegram(publishing);
    } else {
      console.log('Nothing to publish today');
    }
  }

  async sendToTelegram(pageCtx) {
    const _category = pageCtx.properties.Category.select.name;
    const categoryBuilderMap = {
      镇站之宝: this.buildBilibiliVideoCtx,
      油管精选: this.buildYoutubeVideoCtx,
      浴室沉思: this.buildThoughtCtx,
      码农诱捕器: this.buildProgrammerCtx,
      每日一歌: this.buildSongCtx,
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

    const finalText = `${_tags}\n\n${_contentText}\n\n频道：@AboutZY`;
    // .trim()
    // .replaceAll(`+`, `\\+`)
    // .replaceAll(`-`, `\\-`);

    console.log(finalText);
    fs.writeFileSync('./dist/finalText.txt', finalText);

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

    if(process.env.NO2TG_AUTO_CHANGE_STATUS === 'true') {
      this.changePageStatus(pageCtx);
    }
  }

  async changePageStatus(pageCtx) {
    await this.notion.pages.update({
      page_id: pageCtx.id,
      properties: {
        Status: {
          select: { name: 'Published' },
        },
      },
    });

    console.log('Page status changed to Published');
  }

  /**
   * category: 镇站之宝
   */
  buildBilibiliVideoCtx(pageCtx, pageBlocks) {
    const _meta = [];
    _meta.push(pageCtx.properties.Original.checkbox ? '👩‍💻 原创：' + '✅' : '❌');
    if (pageCtx.properties.Original.checkbox) {
      const up = pageCtx.properties.UPLink.url
        ? this._buildLink(
            pageCtx.properties.UP.rich_text[0].plain_text,
            pageCtx.properties.UPLink.url
          )
        : pageCtx.properties.UP.rich_text[0].plain_text;
      _meta.push(`🆙 UP：${up}`);
    }
    if (pageCtx.properties.VideoPubDate.date) {
      _meta.push(
        `⏰ 发布时间：${this._getPlainText(
          this._formatDate(pageCtx.properties.VideoPubDate.date.start)
        )}`
      );
    }
    const meta = _meta.join('\n');

    return `${this._buildVideoTitle(pageCtx)}

${meta}

${this._translateBlocks(pageBlocks)}`;
  }

  /**
   * 油管精选
   */
  buildYoutubeVideoCtx(pageCtx, pageBlocks) {
    const _meta = [];
    _meta.push(pageCtx.properties.Original.checkbox ? '👩‍💻 原创：' + '✅' : '❌');
    if (pageCtx.properties.Original.checkbox) {
      const up = pageCtx.properties.UPLink.url
        ? this._buildLink(
            pageCtx.properties.UP.rich_text[0].plain_text,
            pageCtx.properties.UPLink.url
          )
        : pageCtx.properties.UP.rich_text[0].plain_text;
      _meta.push(`🆙 UP：${up}`);
    }
    if (pageCtx.properties.VideoPubDate.date) {
      _meta.push(
        `⏰ 发布时间：${this._getPlainText(
          this._formatDate(pageCtx.properties.VideoPubDate.date.start)
        )}`
      );
    }
    const meta = _meta.join('\n');

    return `${this._buildVideoTitle(pageCtx)}

${meta}

${this._translateBlocks(pageBlocks)}`;
  }

  /**
   * 浴室沉思
   */
  buildThoughtCtx(pageCtx, pageBlocks) {
    return this._translateBlocks(pageBlocks);
  }

  /**
   * 码农诱捕器
   */
  buildProgrammerCtx(pageCtx, pageBlocks) {
    return `${this._buildProjectTitle(pageCtx)}

${this._translateBlocks(pageBlocks)}`;
  }

  buildSongCtx(pageCtx, pageBlocks) {
    return `${this._buildProjectTitle(pageCtx)}

${this._translateBlocks(pageBlocks)}`;
  }

  /**
   * 构建链接
   */
  _buildLink(label, link) {
    return `[${label}](${link})`;
  }

  /**
   * 构建视频标题
   */
  _buildVideoTitle(pageCtx) {
    const plainTextTitle = `*${this._getPlainText(pageCtx.properties.Name.title[0].plain_text)}*`;
    const title = pageCtx.properties.VideoLink.url
      ? this._buildLink(plainTextTitle, pageCtx.properties.VideoLink.url)
      : plainTextTitle;
    const emoji = pageCtx.icon?.emoji;

    return emoji ? emoji + ' ' + title : title;
  }

  /**
   * 构建项目
   * @TODO: 优化
   */
  _buildProjectTitle(pageCtx) {
    const plainTextTitle = `*${this._getPlainText(pageCtx.properties.Name.title[0].plain_text)}*`;
    const title = pageCtx.properties.ProjectLink.url
      ? this._buildLink(plainTextTitle, pageCtx.properties.ProjectLink.url)
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
        const withFormatText = block.paragraph.text
          .map((part) => {
            let thisPart = '';

            // 如果文本是代码
            if (part.annotations.code) {
              thisPart = '`' + this._getPlainText(part.plain_text) + '`';
            }
            // 链接，加粗，斜体，删除线，下划线可共存
            else {
              thisPart = part.href
                ? `[${this._getPlainText(part.plain_text)}](${part.href})`
                : this._getPlainText(part.plain_text);
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

          // 支持以 空格|空格 的形式切分单行单行文本
        return withFormatText.indexOf(' | ') > -1
          ? withFormatText.split(' | ').join('\n')
          : withFormatText;
      })
      .join('\n\n')
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

  _getPlainText(str) {
    return str
      .replaceAll(`+`, `\\+`)
      .replaceAll(`_`, `\\_`)
      .replaceAll(`?`, `\\?`)
      .replaceAll(`(`, `\\(`)
      .replaceAll(`)`, `\\)`)
      .replaceAll(`[`, `\\[`)
      .replaceAll(`]`, `\\]`)
      .replaceAll(`.`, `\\.`)
      .replaceAll(`-`, `\\-`);
  }
}

(async () => {
  const no2tg = new No2tg();
  await no2tg.init();
  no2tg.sendTodayUpdates();
})();
