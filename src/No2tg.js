const Day = require('dayjs');
const Axios = require('axios');
const { Client } = require('@notionhq/client');

class No2tg {
  constructor({ databaseId, notionAuthKey, telegramBotToken, telegramChatId }) {
    this.databaseId = databaseId;
    this.telegramChatId = telegramChatId;

    this.notion = new Client({ auth: notionAuthKey });

    this.http = Axios.create({
      baseURL: `https://api.telegram.org/bot${telegramBotToken}`,
      headers: { 'Content-Type': 'application/json' },
    });
    this.http.interceptors.response.use(
      (res) => res,
      (err) => {
        console.error('HTTP ERROR', err);
        return Promise.reject(err.response);
      }
    );
  }

  /**
   * 根据 ID 发送
   * @param {string} pageId Notion 页面 ID
   */
  async sendById(pageId) {
    const resOfNotion = await this.notion.pages.retrieve({  page_id: pageId  });

    if (!resOfNotion.id) {
      console.log('No page. Please recheck pageId.');
      return;
    }

    this._send(resOfNotion);
  }

  /**
   * 根据日期发送
   * @param {dayjs.ConfigType} day YYYY-MM-DD
   */
  async sendByDay(day) {
    const resOfNotion = await this.notion.databases.query({
      database_id: this.databaseId,
      page_size: 50,
      filter: {
        and: [
          {
            property: 'PlanningPublish',
            date: { equals: Day(day).format('YYYY-MM-DD') },
          },
          {
            property: 'Status',
            select: { equals: 'Completed' },
          },
        ],
      },
    });

    // 每次仅发布第一个
    if (!resOfNotion.results.length) {
      console.log('Nothing to publish today');
      return;
    }

    // 对发送列表进行排序
    const sortedResults = resOfNotion.results.sort((a, b) => a.properties.PubOrder.number - b.properties.PubOrder.number);

    this._send(sortedResults[0]);
  }

  /**
   * 向 Telegram 发送消息
   * @param {NotionPageCtx} publishing 要发送的 Notion 页面上下文
   */
  async _send(publishing) {
    // ============================================
    // 获取封面
    // ============================================
    const COVERS = this._buildCovers(publishing);

    // ============================================
    // 获取动态模板
    // @TODO
    // ============================================
    // const TEMPLATE = this._getTemplate(publishing.properties.Template.relation[0].id);

    // const partials = {};
    // if (TEMPLATE.indexOf('[[_TAGS]]') > -1) {
    //   partials._TAGS = this._buildTags(publishing);
    // }
    // if (TEMPLATE.indexOf('[[_TITLE]]')> -1) {
    //   partials._TITLE = this._buildTitle(publishing);
    // }
    // if (TEMPLATE.indexOf('[[_CONTENT]]')> -1) {
    //   const pageBlocks = await this.notion.blocks.children.list({ block_id: publishing.id });
    //   partials._CONTENT = this._buildContent(pageBlocks.results);
    // }

    // ============================================
    // 获取最终的正文
    // ============================================
    let template = '';
    const templatePartials = {};

    // 标签
    template += `[[_TAGS]]\n\n`;
    templatePartials._TAGS = this._buildTags(publishing);

    // 标题
    if (!publishing.properties.IsHideTitle.checkbox) {
      template += `[[_TITLE]]\n\n`;
      templatePartials._TITLE = this._buildTitle(publishing);
    }

    // 视频元信息
    if (publishing.properties.WithVideoMeta.checkbox) {
      template += `[[_VIDEO_META]]\n\n`;
      templatePartials._VIDEO_META = this._buildVideoMeta(publishing);
    }

    // 内容
    template += `[[_CONTENT]]\n\n`;
    const pageBlocks = await this.notion.blocks.children.list({ block_id: publishing.id });
    templatePartials._CONTENT = this._buildContent(pageBlocks.results);

    // 频道名
    if (!publishing.properties.IsHideCopyright.checkbox) {
      template += `频道：@AboutZY`;
    }

    const FINAL_TEXT = this._templateToText(template, templatePartials);
    console.log('FINAL_TEXT', FINAL_TEXT);

    // ============================================
    // 发送给 Telegram
    // ============================================
    let api;
    let reqData = { chat_id: this.telegramChatId };

    // 无封面
    if (!COVERS.length) {
      api = '/sendMessage';
      reqData = { ...reqData, text: FINAL_TEXT, parse_mode: 'MarkdownV2' };
    }
    // 只有一张封面图
    else if (COVERS.length === 1) {
      api = '/sendPhoto';
      reqData = { ...reqData, caption: FINAL_TEXT, photo: COVERS[0], parse_mode: 'MarkdownV2' };
    }
    // 多张封面图
    else {
      api = '/sendMediaGroup';
      const medias = COVERS.map((cover) => ({
        type: 'photo',
        media: cover,
        parse_mode: 'MarkdownV2',
      }));
      medias[0].caption = FINAL_TEXT;
      reqData = { ...reqData, media: medias };
    }

    const resOfTelegram = await this.http({
      url: api,
      method: 'POST',
      data: reqData,
    });

    console.log(`Sent!`, resOfTelegram.data);

    // ============================================
    // 更新 Notion 中的 Post 状态
    // ============================================
    if (process.env.NO2TG_AUTO_CHANGE_STATUS === 'true') {
      await this.notion.pages.update({
        page_id: publishing.id,
        properties: {
          Status: {
            select: { name: 'Published' },
          },
        },
      });

      console.log('Page status changed to Published');
    }

    console.log(`All Done!`, publishing);
  }

  /**
   * 获取模板
   */
  async _getTemplate(templatePageId) {
    const templatePage = await this.notion.blocks.children.list({ block_id: templatePageId });
    const templateText = templatePage.results.find((block) => block.type === 'code').code.text[0]
      .plain_text;

    return templateText;
  }

  /**
   * 将模板中的标签替换为真实内容
   */
  _templateToText(template, partials) {
    Object.keys(partials).forEach((key) => {
      template = template.replace(`[[${key}]]`, partials[key]);
    });

    return template;
  }

  /**
   * 构建一个链接
   */
  _buildLink(text, url) {
    return `[${text}](${url})`;
  }

  /**
   * 构建封面
   */
  _buildCovers(pageCtx) {
    return pageCtx.properties.Cover.files.map((cover) => cover.file.url);
  }

  /**
   * 构建标签。分类总是第一个标签
   */
  _buildTags(pageCtx) {
    const category = pageCtx.properties.Category.select.name;
    const tags = pageCtx.properties.Tags.multi_select.map((tag) => tag.name);

    return [category, ...tags].map((tag) => `\\#${tag}`).join(' ');
  }

  /**
   * 构建标题。自动组装 TitleLink 和 Emoji
   */
  _buildTitle(pageCtx) {
    const plainTextTitle = pageCtx.properties.Name.title.map((title) => title.plain_text).join('');
    const escapedTitle = this._escapeText(plainTextTitle);
    const boldedTitle = `*${escapedTitle}*`;
    const linkedTitle = pageCtx.properties.TitleLink.url
      ? this._buildLink(boldedTitle, pageCtx.properties.TitleLink.url)
      : boldedTitle;
    const emoji = pageCtx.icon?.emoji;

    return emoji ? emoji + ' ' + linkedTitle : linkedTitle;
  }

  /**
   * 对文本进行转义，保证符号能够正确输出
   * <https://core.telegram.org/bots/api#markdownv2-style>
   */
  _escapeText(str) {
    return str.replace(/[_*[\]()>~#+\-=|{}.!\\]/g, '\\$&');
  }

  /**
   * 构建内容
   */
  _buildContent(pageBlocks) {
    return pageBlocks
      .map((block) => this._translateNotionTextsToMarkdown(block.paragraph.text))
      .join('\n')
      .trim();
  }

  /**
   * 把 Notion 格式的副文本区块转换为 Telegram 格式的副本文内容
   */
  _translateNotionTextsToMarkdown(texts) {
    return texts
      .map((part) => {
        let partText = this._escapeText(part.plain_text);

        // 如果文本是代码
        if (part.annotations.code) {
          partText = '`' + partText + '`';
        }
        // 链接，加粗，斜体，删除线，下划线可共存
        else {
          if (part.href) {
            partText = this._buildLink(partText, part.href);
          }
          if (part.annotations.bold) {
            partText = `*${partText}*`;
          }
          if (part.annotations.italic) {
            partText = `_${partText}_`;
          }
          if (part.annotations.underline) {
            partText = `__${partText}__`;
          }
          if (part.annotations.strikethrough) {
            partText = `~${partText}~`;
          }
        }

        return partText;
      })
      .join('');
  }

  /**
   * 构建视频信息
   */
  _buildVideoMeta(pageCtx) {
    const meta = [];

    // 原创
    meta.push(pageCtx.properties.vOriginal.checkbox ? '👩‍💻 原创：' + '✅' : '❌');
    // UP 主信息
    if (pageCtx.properties.vUp.rich_text.length) {
      const upText = this._translateNotionTextsToMarkdown(pageCtx.properties.vUp.rich_text);
      meta.push(`🆙 UP：${upText}`);
    }
    // 发布时间
    if (pageCtx.properties.vPubDate.date) {
      const videoPubTime = pageCtx.properties.vPubDate.date.start;
      const formattedPubTime = Day(videoPubTime).format('YYYY-MM-DD');
      const escapedPubTime = this._escapeText(formattedPubTime);
      meta.push(`⏰ 发布时间：${escapedPubTime}`);
    }

    return meta.join('\n');
  }
}

module.exports = No2tg;
