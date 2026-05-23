require('dotenv').config();

const fs = require('fs');
const crypto = require('crypto');
const cron = require('node-cron');
const fetch = globalThis.fetch || require('node-fetch');
const express = require('express');

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ButtonBuilder,
  ActionRowBuilder,
  ButtonStyle,
  REST,
  Routes,
  SlashCommandBuilder,
} = require('discord.js');

const app = express();

/* Render監視用 */
app.get('/', (req, res) => {
  res.send('Bot is running');
});

app.listen(process.env.PORT || 3000, () => {
  console.log('Web server started');
});

const TOKEN = process.env.TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;
const CLIENT_ID = process.env.CLIENT_ID;

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

async function setOfflineStatus() {
  try {
    if (client.user) {
      await client.user.setStatus('invisible');
    }
  } catch (err) {
    console.error('Failed to set offline status:', err);
  }
}

const shutdown = async (code = 0) => {
  await setOfflineStatus();

  try {
    await client.destroy();
  } catch {}

  process.exit(code);
};

process.on('uncaughtException', async error => {
  console.error(error);
});

process.on('unhandledRejection', async reason => {
  console.error(reason);
});

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

const UPDATE_URL = process.env.UPDATE_URL || process.env.URL;

const UPDATE_DATA_URL =
  process.env.UPDATE_DATA_URL ||
  process.env.UPDATEDATA_URL ||
  process.env.DETAIL_URL ||
  UPDATE_URL;

const GAME_ID = process.env.GAME_ID;
const PRIVATE_KEY = process.env.PRIVATE_KEY;

if (
  !TOKEN ||
  !CHANNEL_ID ||
  !CLIENT_ID ||
  !UPDATE_URL ||
  !UPDATE_DATA_URL ||
  !GAME_ID ||
  !PRIVATE_KEY
) {
  console.error(
    'Missing required environment variables.'
  );

  process.exit(1);
}

const GAMEJOLT_API_BASE =
  'https://api.gamejolt.com/api/game/v1_2';

function buildGameJoltUrl(
  endpoint,
  params = {},
  bodyFlat = ''
) {
  const url = new URL(GAMEJOLT_API_BASE + endpoint);

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null)
      return;

    url.searchParams.append(key, String(value));
  });

  url.searchParams.append('game_id', GAME_ID);
  url.searchParams.append('format', 'json');

  const signature = crypto
    .createHash('md5')
    .update(url.toString() + bodyFlat + PRIVATE_KEY)
    .digest('hex');

  url.searchParams.append('signature', signature);

  return url;
}

function compareVersion(v1, v2) {
  if (v1 === v2) return 0;

  const normalize = v =>
    String(v)
      .trim()
      .split('.')
      .map(part => {
        const num = parseInt(part, 10);

        return Number.isNaN(num) ? part : num;
      });

  const a = normalize(v1);
  const b = normalize(v2);

  const len = Math.max(a.length, b.length);

  for (let i = 0; i < len; i++) {
    const x = a[i] !== undefined ? a[i] : 0;
    const y = b[i] !== undefined ? b[i] : 0;

    if (
      typeof x === 'number' &&
      typeof y === 'number'
    ) {
      if (x > y) return 1;
      if (x < y) return -1;

      continue;
    }

    const sx = String(x);
    const sy = String(y);

    if (sx > sy) return 1;
    if (sx < sy) return -1;
  }

  return 0;
}

async function getUserData(userId) {
  const key = `user_${userId}_data`;

  const url = buildGameJoltUrl('/data-store/', {
    key,
    user_id: userId,
  });

  try {
    const res = await fetch(url);
    const json = await res.json();

    const response = json?.response;

    if (!response) return null;

    const success = response.success;
    const data = response.data ?? null;

    if (success !== 'true' && success !== true) {
      return null;
    }

    return data;
  } catch (e) {
    console.error('GameJolt API error:', e);
    return null;
  }
}

async function fetchVersion() {
  try {
    const res = await fetch(UPDATE_URL);

    const text = await res.text();

    const match = text.match(
      /version\s*[:]\s*([\w.]+)/i
    );

    return match ? match[1] : 'unknown';
  } catch {
    return 'error';
  }
}

async function checkVersion(force = false) {
  try {
    const version = await fetchVersion();

    let old = '';

    if (fs.existsSync('./version.txt')) {
      old = fs.readFileSync(
        './version.txt',
        'utf8'
      ).trim();
    }

    if (
      version === 'unknown' ||
      version === 'error'
    ) {
      return false;
    }

    if (
      old &&
      compareVersion(version, old) <= 0 &&
      !force
    ) {
      return false;
    }

    if (
      !old ||
      compareVersion(version, old) === 1
    ) {
      fs.writeFileSync('./version.txt', version);
    }

    let detail = 'なし';

    try {
      const d = await fetch(UPDATE_DATA_URL);

      detail = await d.text();
    } catch {}

    const embed = new EmbedBuilder()
      .setColor(0x2b2d31)
      .setTitle(`🆕 Version ${version}`)
      .setDescription(
        '```md\n' +
          detail.slice(0, 3000) +
          '\n```'
      );

    const button = new ButtonBuilder()
      .setLabel('インストール')
      .setStyle(ButtonStyle.Link)
      .setURL(
        'https://gamejolt.com/games/shiftline/1053992'
      );

    const row =
      new ActionRowBuilder().addComponents(
        button
      );

    const channel =
      await client.channels.fetch(CHANNEL_ID);

    await channel.send({
      embeds: [embed],
      components: [row],
    });

    return true;
  } catch (e) {
    console.error(e);
    return false;
  }
}

client.once('ready', async () => {
  console.log('BOT ONLINE:', client.user.tag);

  await checkVersion();

  cron.schedule('*/5 * * * *', async () => {
    try {
      await checkVersion();
    } catch (e) {
      console.error('cron error', e);
    }
  });
});

const commands = [
  new SlashCommandBuilder()
    .setName('updatecheck')
    .setDescription('アップデート確認'),

  new SlashCommandBuilder()
    .setName('nowversion')
    .setDescription('現在のバージョン'),

  new SlashCommandBuilder()
    .setName('profile')
    .setDescription('ユーザー情報')
    .addStringOption(opt =>
      opt
        .setName('userid')
        .setDescription('ID')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('restart')
    .setDescription('ボットを再起動します'),

  new SlashCommandBuilder()
    .setName('exit')
    .setDescription('ボットを終了します'),
].map(c => c.toJSON());

const rest = new REST({
  version: '10',
}).setToken(TOKEN);

(async () => {
  try {
    await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      {
        body: commands,
      }
    );

    console.log('commands ready');
  } catch (e) {
    console.error(e);
  }
})();

client.on(
  'interactionCreate',
  async interaction => {
    if (!interaction.isChatInputCommand())
      return;

    // updatecheck
    if (interaction.commandName === 'updatecheck') {
      await interaction.reply({
        content: '確認中...',
      });

      const version = await fetchVersion();

      let old = '';

      if (fs.existsSync('./version.txt')) {
        old = fs.readFileSync(
          './version.txt',
          'utf8'
        ).trim();
      }

      if (
        version === 'unknown' ||
        version === 'error'
      ) {
        return interaction.followUp({
          content: '取得失敗',
        });
      }

      const updated =
        !old ||
        compareVersion(version, old) === 1;

      if (updated) {
        await checkVersion();
      }

      await interaction.followUp({
        content: updated
          ? `更新あり (${version})`
          : `更新なし (${version})`,
      });
    }

    // nowversion
    if (interaction.commandName === 'nowversion') {
      const v = await fetchVersion();

      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle('Version')
            .setDescription(v),
        ],
      });
    }

    // profile
    if (interaction.commandName === 'profile') {
      const id =
        interaction.options.getString('userid');

      await interaction.reply({
        content: '取得中...',
      });

      const data = await getUserData(id);

      if (!data) {
        return interaction.followUp(
          'データなし'
        );
      }

      let displayValue = data;

      try {
        const parsed = JSON.parse(data);

        displayValue = JSON.stringify(
          parsed,
          null,
          2
        );
      } catch {
        displayValue = String(data);
      }

      if (displayValue.length > 1000) {
        displayValue =
          displayValue.slice(0, 1000) + '...';
      }

      await interaction.followUp({
        embeds: [
          new EmbedBuilder()
            .setTitle(id)
            .addFields(
              {
                name: 'ユーザーID',
                value: id,
                inline: false,
              },
              {
                name: 'データ',
                value: displayValue,
                inline: false,
              }
            ),
        ],
      });
    }

    // restart
    if (interaction.commandName === 'restart') {
      await interaction.reply(
        'ボットを再起動します...'
      );

      await shutdown(0);
    }

    // exit
    if (interaction.commandName === 'exit') {
      await interaction.reply(
        'ボットを終了します...'
      );

      await shutdown(0);
    }
  }
);

client.login(TOKEN).catch(async e => {
  console.error(
    'Discord login failed:',
    e
  );

  await shutdown(1);
});
