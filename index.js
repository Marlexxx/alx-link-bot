// ALX Link Bot — standalone with admin system
const https = require('https');
const fs = require('fs');
const path = require('path');

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_IDS = (process.env.ADMIN_IDS || process.env.ALLOWED_IDS || '')
  .split(',').map(id => parseInt(id.trim())).filter(Boolean);

const CHANNELS = {
  luna:   process.env.LUNA_CHANNEL_ID,
  juliaa: process.env.JULIA_CHANNEL_ID,
  sophia: process.env.SOPHIA_CHANNEL_ID,
};

// Canaux Twitter (séparés) — utilisés quand le support est AdsPower
const TWITTER_CHANNELS = {
  luna:   process.env.LUNA_TWITTER_CHANNEL_ID,
  juliaa: process.env.JULIA_TWITTER_CHANNEL_ID,
  sophia: process.env.SOPHIA_TWITTER_CHANNEL_ID,
};

const LABELS = {
  luna:   '🍓 Luna',
  juliaa: '💜 Juliaa',
  sophia: '🩵 Sophia',
};

// ─── STOCKAGE (Volume Railway /data) ──────────────────────────────────────────
const DATA_DIR = process.env.DATA_DIR || '/data';
const ACCESS_FILE = path.join(DATA_DIR, 'access.json');

// { approved: { tgId: {name, approved_at, approved_by} }, pending: { tgId: {name, requested_at, tg_username} } }
let approvedUsers = {};
let pendingUsers = {};

function loadAccess() {
  try {
    if (fs.existsSync(ACCESS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(ACCESS_FILE, 'utf8'));
      approvedUsers = raw.approved || {};
      pendingUsers = raw.pending || {};
    } else {
      approvedUsers = {};
      pendingUsers = {};
      saveAccess();
    }
  } catch (err) {
    console.error('⚠️ Erreur lecture access.json:', err.message);
    approvedUsers = approvedUsers || {};
    pendingUsers = pendingUsers || {};
  }
  console.log(`📋 Accès chargés: ${Object.keys(approvedUsers).length} VAs, ${Object.keys(pendingUsers).length} en attente`);
}

function saveAccess() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(ACCESS_FILE, JSON.stringify({ approved: approvedUsers, pending: pendingUsers }, null, 2));
  } catch (err) {
    console.error('⚠️ Erreur écriture access.json:', err.message);
  }
}

function isAdmin(userId) {
  return ADMIN_IDS.includes(userId);
}

function isApproved(userId) {
  return isAdmin(userId) || !!approvedUsers[String(userId)];
}

const userState = {};
const processedMessages = new Set();
let offset = 0;

// ─── API TELEGRAM ────────────────────────────────────────────────────────────
function api(method, params = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(params);
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${BOT_TOKEN}/${method}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve(JSON.parse(body)));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

const send = (chatId, text, extra = {}) =>
  api('sendMessage', { chat_id: chatId, text, parse_mode: 'Markdown', ...extra });

// ─── ADMIN HANDLERS ──────────────────────────────────────────────────────────

async function handleAdmin(userId) {
  const pendingList = Object.entries(pendingUsers);
  const approvedList = Object.entries(approvedUsers);

  let text = '🔧 *Panel Admin*\n\n';

  if (pendingList.length > 0) {
    text += `⏳ *Demandes en attente (${pendingList.length}) :*\n`;
    pendingList.forEach(([id, u]) => {
      text += `  • ${u.name} — \`${id}\`\n`;
    });
    text += '\n';
  } else {
    text += '✅ Aucune demande en attente\n\n';
  }

  text += `👥 *VAs actifs (${approvedList.length}) :*\n`;
  if (approvedList.length > 0) {
    approvedList.forEach(([id, u]) => {
      text += `  • ${u.name} — \`${id}\`\n`;
    });
  } else {
    text += '  _Aucun VA pour l\'instant_\n';
  }

  const buttons = [];
  if (pendingList.length > 0) {
    buttons.push([{ text: '✅ Accepter une demande', callback_data: 'admin_accept' }]);
    buttons.push([{ text: '❌ Refuser une demande', callback_data: 'admin_reject' }]);
  }
  if (approvedList.length > 0) {
    buttons.push([{ text: '🚫 Retirer un VA', callback_data: 'admin_remove' }]);
  }
  buttons.push([{ text: '🔄 Rafraîchir', callback_data: 'admin_refresh' }]);

  await send(userId, text, {
    reply_markup: { inline_keyboard: buttons }
  });
}

async function showPendingList(userId, action) {
  const pendingList = Object.entries(pendingUsers);
  if (pendingList.length === 0) {
    await send(userId, '✅ Aucune demande en attente.');
    return;
  }

  const verb = action === 'accept' ? '✅ Accepter' : '❌ Refuser';
  const buttons = pendingList.map(([id, u]) => ([
    { text: `${u.name}`, callback_data: `do_${action}_${id}` }
  ]));
  buttons.push([{ text: '↩️ Retour', callback_data: 'admin_back' }]);

  await send(userId, `${verb} qui ?`, {
    reply_markup: { inline_keyboard: buttons }
  });
}

async function showApprovedList(userId) {
  const approvedList = Object.entries(approvedUsers);
  if (approvedList.length === 0) {
    await send(userId, '_Aucun VA à retirer._');
    return;
  }

  const buttons = approvedList.map(([id, u]) => ([
    { text: `🚫 ${u.name}`, callback_data: `do_remove_${id}` }
  ]));
  buttons.push([{ text: '↩️ Retour', callback_data: 'admin_back' }]);

  await send(userId, '🚫 *Retirer quel VA ?*', {
    reply_markup: { inline_keyboard: buttons }
  });
}

async function acceptUser(targetId, adminId) {
  const pending = pendingUsers[targetId];
  if (!pending) return send(adminId, '⚠️ Cette demande n\'existe plus.');

  approvedUsers[targetId] = { name: pending.name, approved_at: new Date().toISOString(), approved_by: String(adminId) };
  delete pendingUsers[targetId];
  saveAccess();

  await send(adminId, `✅ *${pending.name}* a été accepté !`);
  await send(Number(targetId),
    `🎉 *Accès approuvé !*\n\nTu peux maintenant utiliser le bot.\nTape /start pour voir les commandes.`
  );
}

async function rejectUser(targetId, adminId) {
  const pending = pendingUsers[targetId];
  if (!pending) return send(adminId, '⚠️ Cette demande n\'existe plus.');

  delete pendingUsers[targetId];
  saveAccess();

  await send(adminId, `❌ *${pending.name}* a été refusé.`);
  await send(Number(targetId),
    `❌ *Demande refusée.*\nContacte un admin si tu penses que c'est une erreur.`
  );
}

async function removeUser(targetId, adminId) {
  const user = approvedUsers[targetId];
  if (!user) return send(adminId, '⚠️ Ce VA n\'est plus dans la liste.');

  delete approvedUsers[targetId];
  saveAccess();

  await send(adminId, `🚫 *${user.name}* a été retiré.`);
  await send(Number(targetId),
    `⚠️ *Ton accès au bot a été retiré.*\nContacte un admin pour plus d'infos.`
  );
}

// ─── POLLING ─────────────────────────────────────────────────────────────────
async function poll() {
  try {
    const res = await api('getUpdates', {
      offset, timeout: 25,
      allowed_updates: ['message', 'callback_query']
    });
    if (!res.ok || !res.result.length) return;

    for (const update of res.result) {
      offset = update.update_id + 1;

      // ─── CALLBACK QUERIES ───
      if (update.callback_query) {
        const cq = update.callback_query;
        const userId = cq.from.id;
        await api('answerCallbackQuery', { callback_query_id: cq.id });

        const state = userState[userId] || {};

        // Admin callbacks
        if (cq.data === 'admin_accept' && isAdmin(userId)) {
          await showPendingList(userId, 'accept');
          continue;
        }
        if (cq.data === 'admin_reject' && isAdmin(userId)) {
          await showPendingList(userId, 'reject');
          continue;
        }
        if (cq.data === 'admin_remove' && isAdmin(userId)) {
          await showApprovedList(userId);
          continue;
        }
        if (cq.data === 'admin_refresh' && isAdmin(userId)) {
          loadAccess();
          await handleAdmin(userId);
          continue;
        }
        if (cq.data === 'admin_back' && isAdmin(userId)) {
          await handleAdmin(userId);
          continue;
        }
        if (cq.data.startsWith('do_accept_') && isAdmin(userId)) {
          const targetId = cq.data.replace('do_accept_', '');
          await acceptUser(targetId, userId);
          continue;
        }
        if (cq.data.startsWith('do_reject_') && isAdmin(userId)) {
          const targetId = cq.data.replace('do_reject_', '');
          await rejectUser(targetId, userId);
          continue;
        }
        if (cq.data.startsWith('do_remove_') && isAdmin(userId)) {
          const targetId = cq.data.replace('do_remove_', '');
          await removeUser(targetId, userId);
          continue;
        }

        // Access check for link creation callbacks
        if (!isApproved(userId)) continue;

        // Channel selection
        if (CHANNELS[cq.data]) {
          userState[userId] = { step: 'waiting_support', canal: cq.data };
          const label = LABELS[cq.data];

          await api('editMessageText', {
            chat_id: cq.message.chat.id,
            message_id: cq.message.message_id,
            text: `🔗 *Nouveau lien de tracking*\n\nCanal : ${label} ✅`,
            parse_mode: 'Markdown'
          });

          await send(userId, '📱 *Quel support ?*', {
            reply_markup: { inline_keyboard: [
              [{ text: '🔵 Ali Remote', callback_data: 'support_ali' }],
              [{ text: '🟢 Iremotech', callback_data: 'support_iremotech' }],
              [{ text: '🐦 AdsPower (Twitter)', callback_data: 'support_adspower' }],
              [{ text: '⚪ Autre (saisie libre)', callback_data: 'support_autre' }]
            ]}
          });
        }

        // Support selection
        else if (cq.data.startsWith('support_')) {
          const support = cq.data.replace('support_', '');
          userState[userId] = { ...state, support };

          const supportLabel = support === 'ali' ? '🔵 Ali Remote' : support === 'iremotech' ? '🟢 Iremotech' : support === 'adspower' ? '🐦 AdsPower (Twitter)' : '⚪ Autre';

          await api('editMessageText', {
            chat_id: cq.message.chat.id,
            message_id: cq.message.message_id,
            text: `📱 Support : ${supportLabel} ✅`,
            parse_mode: 'Markdown'
          });

          if (support === 'autre') {
            userState[userId].step = 'waiting_name';
            await send(userId, '✏️ Tape le nom complet du lien de tracking :\n_(ex: tiktok\\_lunarss\\_ali\\_noctis)_');
          } else if (support === 'adspower') {
            // AdsPower = Twitter : canal Twitter dédié
            const twChannel = TWITTER_CHANNELS[state.canal];
            if (!twChannel) {
              await send(userId, `❌ Canal Twitter non configuré pour ${LABELS[state.canal]}.\nAjoute la variable \`${state.canal.toUpperCase()}_TWITTER_CHANNEL_ID\` sur Railway.`);
              delete userState[userId];
              continue;
            }
            userState[userId] = { ...userState[userId], source: 'twitter', step: 'waiting_va_twitter' };
            await send(userId, '🧑‍💼 *Tape le nom du VA :*\n_(ex: waldi, arsenne...)_');
          } else {
            userState[userId].step = 'waiting_source';
            await send(userId, '📲 *Quelle source de trafic ?*', {
              reply_markup: { inline_keyboard: [
                [{ text: '📷 Instagram', callback_data: 'source_insta' }],
                [{ text: '🧵 Thread', callback_data: 'source_thread' }],
                [{ text: '📘 Facebook', callback_data: 'source_facebook' }]
              ]}
            });
          }
        }

        // Traffic source selection
        else if (cq.data.startsWith('source_')) {
          const source = cq.data.replace('source_', '');
          userState[userId] = { ...state, source, step: 'waiting_compte' };

          const sourceLabel = source === 'insta' ? '📷 Instagram' : source === 'thread' ? '🧵 Thread' : '📘 Facebook';

          await api('editMessageText', {
            chat_id: cq.message.chat.id,
            message_id: cq.message.message_id,
            text: `📲 Source : ${sourceLabel} ✅`,
            parse_mode: 'Markdown'
          });

          await send(userId, '👤 *Tape le nom du compte :*\n_(ex: lunafd, lunaqtxr, lunarss...)_');
        }

        // Rôle du VA Twitter (posteur / chatteur)
        else if (cq.data === 'role_chatteur' || cq.data === 'role_posteur') {
          if (!state.va) { continue; }
          const role = cq.data.replace('role_', '');

          await api('editMessageText', {
            chat_id: cq.message.chat.id,
            message_id: cq.message.message_id,
            text: `👥 VA : ${role === 'posteur' ? '✍️ Posteur' : '💬 Chatteur'} ✅`,
            parse_mode: 'Markdown'
          });

          if (role === 'chatteur') {
            // Chatteur : lien direct → Twitter {va}
            const sourceName = `Twitter ${state.va}`;
            await createLink(userId, state.canal, sourceName, { from: cq.from }, 'adspower');
          } else {
            // Posteur : choix du type de lien
            userState[userId] = { ...state, step: 'waiting_twtype' };
            await send(userId, '🔗 *Quel lien veux-tu ?*', {
              reply_markup: { inline_keyboard: [
                [{ text: '📝 Bio', callback_data: 'twtype_bio' }],
                [{ text: '📌 Pin post', callback_data: 'twtype_pin' }],
                [{ text: '🔥 CTA', callback_data: 'twtype_cta' }]
              ]}
            });
          }
        }

        // Type de lien pour VA posteur Twitter
        else if (cq.data.startsWith('twtype_')) {
          if (!state.va) { continue; }
          const type = cq.data.replace('twtype_', '');
          const typeLabel = type === 'bio' ? '📝 Bio' : type === 'pin' ? '📌 Pin post' : '🔥 CTA';

          await api('editMessageText', {
            chat_id: cq.message.chat.id,
            message_id: cq.message.message_id,
            text: `🔗 Lien : ${typeLabel} ✅`,
            parse_mode: 'Markdown'
          });

          let sourceName;
          if (type === 'bio')      sourceName = `Twitter ${state.va}`;
          else if (type === 'pin') sourceName = `Twitter pin post ${state.va}`;
          else                     sourceName = `Twitter CTA commentaire ${state.va}`;

          await createLink(userId, state.canal, sourceName, { from: cq.from }, 'adspower');
        }

        continue;
      }

      // ─── MESSAGES ───
      if (!update.message) continue;
      const msg = update.message;

      if (processedMessages.has(msg.message_id)) continue;
      processedMessages.add(msg.message_id);
      if (processedMessages.size > 500) {
        const arr = [...processedMessages];
        arr.splice(0, 250).forEach(id => processedMessages.delete(id));
      }

      const userId = msg.from.id;
      const text = (msg.text || '').trim();

      // ─── /admin (admins only) ───
      if (text === '/admin') {
        if (!isAdmin(userId)) {
          await send(userId, '⛔ Réservé aux admins.');
          continue;
        }
        loadAccess();
        await handleAdmin(userId);
        continue;
      }

      // ─── /start ───
      if (text === '/start') {
        if (isApproved(userId)) {
          let msg2 = '👋 *ALX Link Bot*\n\n' +
            'Crée des liens de tracking pour les canaux Telegram.\n\n' +
            '📋 *Commandes :*\n' +
            '• /newlink — créer un nouveau lien\n' +
            '• /template — voir le format des noms\n' +
            '• /listlinks — voir les liens récents\n' +
            '• /cancel — annuler';
          if (isAdmin(userId)) msg2 += '\n• /admin — gérer les accès';
          await send(userId, msg2);
        } else if (pendingUsers[String(userId)]) {
          await send(userId, '⏳ *Ta demande est en attente.*\nUn admin va la valider bientôt.');
        } else {
          userState[userId] = { step: 'waiting_request_name' };
          await send(userId,
            '👋 *Bienvenue sur ALX Link Bot !*\n\n' +
            'Pour utiliser ce bot, tu dois demander l\'accès.\n\n' +
            '✏️ *Quel est ton prénom / pseudo ?*'
          );
        }
        continue;
      }

      // ─── Access request flow (unapproved user giving their name) ───
      const state = userState[userId];
      if (state && state.step === 'waiting_request_name') {
        const name = text.trim();
        if (!name || name.startsWith('/')) {
          await send(userId, '✏️ Tape ton prénom ou pseudo :');
          continue;
        }

        pendingUsers[String(userId)] = { name, requested_at: new Date().toISOString(), tg_username: msg.from.username || '' };
        delete userState[userId];
        saveAccess();

        await send(userId,
          `✅ *Demande envoyée !*\n\nNom : *${name}*\nUn admin va valider ton accès.`
        );

        // Notify admins
        for (const adminId of ADMIN_IDS) {
          await send(adminId,
            `🔔 *Nouvelle demande d'accès*\n\n` +
            `👤 ${name}\n` +
            `🆔 \`${userId}\`\n` +
            `📎 @${msg.from.username || 'pas de username'}\n\n` +
            `→ /admin pour accepter ou refuser`
          );
        }
        continue;
      }

      // ─── Access check for all other commands ───
      if (!isApproved(userId)) {
        if (pendingUsers[String(userId)]) {
          await send(userId, '⏳ *Ta demande est en attente.*\nUn admin va la valider bientôt.');
        } else {
          userState[userId] = { step: 'waiting_request_name' };
          await send(userId,
            '⛔ *Accès requis.*\n\n✏️ Tape ton prénom / pseudo pour demander l\'accès :'
          );
        }
        continue;
      }

      // /template
      if (text === '/template') {
        await send(userId,
          '📋 *Format des noms de liens*\n\n' +
          '`source_support_compte_va`\n\n' +
          '*Exemples (Ali Remote) :*\n' +
          '• `insta_ali_lunafd_arsenne`\n' +
          '• `facebook_ali_lunapage_noctis`\n' +
          '• `thread_ali_lunaqtxr_arsenne`\n\n' +
          '*Exemples (Iremotech) :*\n' +
          '• `insta_ir_lunafd_noctis`\n' +
          '• `facebook_ir_lunapage_arsenne`\n\n' +
          '*Règles :*\n' +
          '— tout en minuscules, pas d\'espaces\n' +
          '— format : source\\_support\\_compte\\_va\n' +
          '— le bot génère le nom automatiquement'
        );
        continue;
      }

      // /newlink
      if (text === '/newlink') {
        userState[userId] = { step: 'waiting_canal' };

        const buttons = Object.entries(CHANNELS)
          .filter(([, id]) => id)
          .map(([key]) => ({ text: LABELS[key], callback_data: key }));

        if (buttons.length === 0) {
          await send(userId, '❌ Aucun canal configuré.');
          continue;
        }

        if (buttons.length === 1) {
          const canal = buttons[0].callback_data;
          userState[userId] = { step: 'waiting_support', canal };
          await send(userId, `🔗 *Nouveau lien — ${LABELS[canal]}*\n\n📱 *Quel support ?*`, {
            reply_markup: { inline_keyboard: [
              [{ text: '🔵 Ali Remote', callback_data: 'support_ali' }],
              [{ text: '🟢 Iremotech', callback_data: 'support_iremotech' }],
              [{ text: '🐦 AdsPower (Twitter)', callback_data: 'support_adspower' }],
              [{ text: '⚪ Autre (saisie libre)', callback_data: 'support_autre' }]
            ]}
          });
          continue;
        }

        await send(userId, '🔗 *Nouveau lien de tracking*\n\nPour quel canal ?', {
          reply_markup: { inline_keyboard: [buttons] }
        });
        continue;
      }

      // /listlinks
      if (text === '/listlinks') {
        const entries = [
          ...Object.entries(CHANNELS).filter(([, id]) => id).map(([model, id]) => ({ model, id, twitter: false })),
          ...Object.entries(TWITTER_CHANNELS).filter(([, id]) => id).map(([model, id]) => ({ model, id, twitter: true })),
        ];
        const results = await Promise.all(
          entries.map(async ({ model, id, twitter }) => {
            const r = await api('exportChatInviteLink', { chat_id: id });
            return { model, twitter, link: r.ok ? r.result : 'N/A' };
          })
        );
        let msg2 = '📋 *Liens principaux :*\n\n';
        results.forEach(r => {
          const label = (LABELS[r.model] || r.model) + (r.twitter ? ' 🐦 Twitter' : '');
          msg2 += `${label}: \`${r.link}\`\n`;
        });
        await send(userId, msg2);
        continue;
      }

      // /cancel
      if (text === '/cancel') {
        delete userState[userId];
        await send(userId, '❌ Annulé.');
        continue;
      }

      // ─── Text input steps (link creation) ───
      if (!state) {
        await send(userId, 'Tape /start pour voir les commandes.');
        continue;
      }

      // Twitter (AdsPower) : nom du VA → choix posteur / chatteur
      if (state.step === 'waiting_va_twitter') {
        const va = text.replace(/\s+/g, ' ').trim().toLowerCase();
        userState[userId] = { ...state, va, step: 'waiting_role' };
        await send(userId, '👥 *Le VA est :*', {
          reply_markup: { inline_keyboard: [
            [{ text: '✍️ Posteur', callback_data: 'role_posteur' }],
            [{ text: '💬 Chatteur', callback_data: 'role_chatteur' }]
          ]}
        });
        continue;
      }

      if (state.step === 'waiting_compte') {
        userState[userId] = { ...state, compte: text.replace(/\s+/g, '').toLowerCase(), step: 'waiting_va' };
        await send(userId, '🧑‍💼 *Tape le nom du VA :*\n_(ex: arsenne, noctis...)_');
        continue;
      }

      if (state.step === 'waiting_va') {
        const va = text.replace(/\s+/g, '').toLowerCase();
        const supportTag = state.support === 'iremotech' ? 'ir' : 'ali';
        const sourceName = `${state.source}_${supportTag}_${state.compte}_${va}`;
        await createLink(userId, state.canal, sourceName, msg, state.support);
        continue;
      }

      if (state.step === 'waiting_name') {
        const sourceName = text.replace(/\s+/g, '_').toLowerCase();
        await createLink(userId, state.canal, sourceName, msg, state.support);
        continue;
      }

      await send(userId, 'Tape /start pour voir les commandes.');
    }
  } catch (err) {
    console.error('Erreur poll:', err.message);
  }
}

async function createLink(userId, canal, sourceName, msg, support) {
  const isTwitter = support === 'adspower';
  const channelId = isTwitter ? TWITTER_CHANNELS[canal] : CHANNELS[canal];

  if (!channelId) {
    await send(userId,
      `❌ Canal ${isTwitter ? 'Twitter ' : ''}non configuré pour ${LABELS[canal]}.\n` +
      `Ajoute la variable \`${canal.toUpperCase()}${isTwitter ? '_TWITTER' : ''}_CHANNEL_ID\` sur Railway.`
    );
    delete userState[userId];
    return;
  }

  try {
    const result = await api('createChatInviteLink', {
      chat_id: channelId,
      name: sourceName,
      creates_join_request: true
    });

    if (!result.ok) throw new Error(result.description);

    const link = result.result.invite_link;
    const label = LABELS[canal] + (isTwitter ? ' 🐦 Twitter' : '');

    await send(userId,
      `✅ *Lien créé !*\n\n` +
      `🔗 \`${link}\`\n` +
      `📌 Source : \`${sourceName}\`\n` +
      `👤 Canal : ${label}\n\n` +
      `_Partage ce lien — les subs seront trackés automatiquement._`
    );

    console.log(`✅ Lien créé: ${sourceName} (${canal}) par ${msg.from.username || userId}`);

  } catch (err) {
    await send(userId,
      `❌ Erreur : ${err.message}\n\n` +
      `Vérifie que le bot est admin du canal avec la permission *"Inviter des utilisateurs"*.`
    );
  }

  delete userState[userId];
}

// ─── START ────────────────────────────────────────────────────────────────────
if (!BOT_TOKEN) { console.error('❌ BOT_TOKEN manquant'); process.exit(1); }

async function start() {
  loadAccess();
  console.log('🔗 ALX Link Bot démarré');
  console.log('👑 Admins:', ADMIN_IDS.length ? ADMIN_IDS.join(', ') : 'AUCUN — configure ADMIN_IDS');
  console.log('📢 Canaux:', Object.entries(CHANNELS).filter(([,v]) => v).map(([k]) => k).join(', ') || 'AUCUN');
  console.log('🐦 Canaux Twitter:', Object.entries(TWITTER_CHANNELS).filter(([,v]) => v).map(([k]) => k).join(', ') || 'AUCUN');

  const wb = await api('deleteWebhook', { drop_pending_updates: false });
  if (wb.ok) console.log('🌐 Webhook supprimé — polling actif');
  else console.error('⚠️ deleteWebhook échoué:', wb.description);

  while (true) {
    await poll();
    await new Promise(r => setTimeout(r, 1000));
  }
}

start();
