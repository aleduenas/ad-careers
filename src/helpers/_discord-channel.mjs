// Owner-only Discord routing and one standing action/blocker message.
const snowflake = value => /^[0-9]{17,20}$/.test(value || '');

export async function resolveProjectChannel(discord, target) {
  const link =
    /^https:\/\/(?:www\.)?discord\.com\/channels\/(\d{17,20})\/(\d{17,20})(?:\/\d{17,20})?\/?$/.exec(
      target,
    );
  let channel, guild;
  if (link || snowflake(target)) {
    channel = await discord.api('GET', `/channels/${link ? link[2] : target}`);
    if (link && channel.guild_id !== link[1])
      throw new Error('Channel server does not match the link.');
  } else {
    const parts = target.split('/');
    if (parts.length !== 2 || parts.some(part => !part.trim()))
      throw new Error('Use a channel link, numeric channel ID, or server-name/channel-name.');
    const guilds = await discord.api('GET', '/users/@me/guilds?limit=200');
    const matches = guilds.filter(
      item => item.name.toLowerCase() === parts[0].trim().toLowerCase(),
    );
    if (matches.length !== 1)
      throw new Error('Server name is missing or ambiguous; use its channel link.');
    guild = matches[0];
    const channels = await discord.api('GET', `/guilds/${guild.id}/channels`);
    const found = channels.filter(
      item => item.type === 0 && item.name === parts[1].trim().replace(/^#/, ''),
    );
    if (found.length !== 1)
      throw new Error('Text channel name is missing or ambiguous; use its channel link.');
    channel = { ...found[0], guild_id: guild.id };
  }
  if (channel.type !== 0 || !snowflake(channel.id) || !snowflake(channel.guild_id))
    throw new Error('Select an ordinary server text channel.');
  return {
    project_channel_id: channel.id,
    project_guild_id: channel.guild_id,
    project_channel_name: channel.name,
  };
}

export function trustedProjectMessage(message, owner, dm, channel, guild) {
  return (
    message.author?.id === owner &&
    !message.author.bot &&
    !message.webhook_id &&
    [0, 19].includes(message.type) &&
    snowflake(message.id) &&
    typeof message.content === 'string' &&
    ((message.channel_id === dm && !message.guild_id) ||
      (message.channel_id === channel && (!message.guild_id || message.guild_id === guild)))
  );
}

export async function channelPermissions(discord, channel, botId) {
  const bot = botId || (await discord.api('GET', '/users/@me')).id;
  const result = await discord.api('GET', `/channels/${channel}/permissions/member/${bot}`);
  const bits = BigInt(result.permissions);
  const required = {
    'View Channel': 1n << 10n,
    'Send Messages': 1n << 11n,
    'Read Message History': 1n << 16n,
  };
  return Object.entries(required)
    .filter(([, bit]) => !(bits & 8n) && !(bits & bit))
    .map(([name]) => name);
}

export async function channelTextEnabled(discord) {
  const app = await discord.api('GET', '/applications/@me');
  return Boolean(Number(app.flags) & ((1 << 18) | (1 << 19)));
}

// Cosmetic status is independent of message delivery and approvals.
export class TopicStatus {
  constructor(discord, channel, { now = Date.now, report = console.error } = {}) {
    this.discord = discord;
    this.channel = channel;
    this.now = now;
    this.report = report;
    this.last = '';
    this.retryAfter = 0;
  }

  async update(actions, blockers, link = '', attentionNeeded = actions > 0) {
    const summary = `Actions: ${actions} | Blockers: ${blockers}${attentionNeeded ? ' | Attention needed' : ''}${link ? ' | ' + link : ''}`;
    if (this.busy || this.last === summary || this.now() < this.retryAfter) return;
    this.busy = true;
    try {
      const topic = summary;
      if (topic.length > 1024) throw new Error('Channel topic has insufficient space for status.');
      await this.discord.api('PATCH', `/channels/${this.channel}`, { topic });
      this.last = summary;
    } catch (error) {
      this.retryAfter = this.now() + 60000;
      this.report(`Discord topic unavailable: ${error.message} Messages and approvals continue.`);
    } finally {
      this.busy = false;
    }
  }
}

export class StatusBoard {
  constructor(
    discord,
    channel,
    guild,
    { saved = {}, save = () => {}, report = console.error } = {},
  ) {
    Object.assign(this, { discord, channel, guild, save, report });
    this.messageId = saved.channel === channel ? saved.messageId : undefined;
    this.topic = new TopicStatus(discord, channel, { report });
    this.lastBody = undefined;
    this.retryAfter = 0;
  }

  async update(actions, blockers, details = {}) {
    if (this.busy || Date.now() < this.retryAfter) return;
    this.busy = true;
    try {
      const section = (items, count, kind) =>
        items?.length
          ? items.map(text => '- ' + text).join('\n')
          : count
            ? `- ${count} ${kind}; the lead has not supplied details yet.`
            : 'No action needed.';
      const body = `**Current actions & blockers**\n\n**Actions:**\n${section(details.actions, actions, 'open action(s)')}\n\n**Blockers:**\n${section(details.blockers, blockers, 'current blocker(s)')}`;
      if (body.length > 2000)
        throw new Error('Action/blocker details must fit in one Discord message.');
      if (body !== this.lastBody) {
        const bot = (await this.discord.api('GET', '/users/@me')).id;
        let existing;
        if (this.messageId) {
          try {
            existing = await this.discord.api(
              'GET',
              `/channels/${this.channel}/messages/${this.messageId}`,
            );
          } catch (error) {
            if (error.status !== 404) throw error;
            this.messageId = undefined;
          }
        }
        if (existing && existing.author?.id !== bot)
          throw new Error('Refusing to edit a status message not owned by this bot.');
        if (existing) this.save({ channel: this.channel, messageId: this.messageId });
        if (!this.messageId) {
          const [sent] = await this.discord.send(this.channel, body, { silent: true });
          this.messageId = sent.id;
          this.save({ channel: this.channel, messageId: this.messageId });
        } else if (existing.content !== body) {
          await this.discord.api('PATCH', `/channels/${this.channel}/messages/${this.messageId}`, {
            content: body,
            allowed_mentions: { parse: [] },
            flags: 4,
          });
        }
        if (!existing?.pinned)
          await this.discord.api(
            'PUT',
            `/channels/${this.channel}/messages/pins/${this.messageId}`,
          );
        this.lastBody = body;
      }
      await this.topic.update(
        actions,
        blockers,
        `https://discord.com/channels/${this.guild}/${this.channel}/${this.messageId}`,
        actions > 0 ||
          Boolean(details.blockers?.some(text => /^\[(?:Needs you|Fully blocked)\]/i.test(text))),
      );
    } catch (error) {
      this.retryAfter = Date.now() + 60000;
      this.report(`Discord status board unavailable: ${error.message} DMs and approvals continue.`);
    } finally {
      this.busy = false;
    }
  }
}
