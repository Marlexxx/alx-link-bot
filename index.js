// ALX Link Bot — standalone
// Manager envoie /newlink → choisit canal → tape nom → reçoit le lien
const https = require('https');

const BOT_TOKEN   = process.env.BOT_TOKEN;
const ALLOWED_IDS = (process.env.ALLOWED_IDS || '')
  .split(',').map(id => parseInt(id.trim())).filter(Boolean);

// Canaux (IDs Telegram des canaux dont le bot est admin)
const CHANNELS = {
  luna:   process.env.LUNA_CHANNEL_ID,
  juliaa: process.env.JULIA_CHANNEL_ID,
  sophia: process.env.SOPHIA_CHANNEL_ID,
};

const LABELS = {
  luna:   '🍓 Luna',
  juliaa: '💜 Juliaa',
  sophia: '🩵 Sophia',
};

const userState = {};
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

      // Bouton sélection canal
      if (update.callback_query) {
        const cq = update.callback_query;
        const userId = cq.from.id;
        await api('answerCallbackQuery', { callback_query_id: cq.id });
        if (!ALLOWED_IDS.includes(userId)) continue;

        const state = userState[userId] || {};

        // Étape 1 : sélection du canal
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
              [{ text: '⚪ Autre (saisie libre)', callback_data: 'support_autre' }]
            ]}
          });
        }

        // Étape 2 : sélection du support
        else if (cq.data.startsWith('support_')) {
          const support = cq.data.replace('support_', '');
          userState[userId] = { ...state, support };

          const supportLabel = support === 'ali' ? '🔵 Ali Remote' : support === 'iremotech' ? '🟢 Iremotech' : '⚪ Autre';

          await api('editMessageText', {
            chat_id: cq.message.chat.id,
            message_id: cq.message.message_id,
            text: `📱 Support : ${supportLabel} ✅`,
            parse_mode: 'Markdown'
          });

          if (support === 'autre') {
            userState[userId].step = 'waiting_name';
            await send(userId, '✏️ Tape le nom complet du lien de tracking :\n_(ex: tiktok\\_lunarss\\_ali\\_noctis)_');
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

        // Étape 3 : sélection de la source (insta/thread/facebook)
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

        continue;
      }

      if (!update.message) continue;
      const msg    = update.message;
      const userId = msg.from.id;
      const text   = (msg.text || '').trim();

      // Accès refusé
      if (!ALLOWED_IDS.includes(userId)) {
        await send(userId, '⛔ Accès non autorisé.');
        continue;
      }

      // /start
      if (text === '/start') {
        await send(userId,
          '👋 *ALX Link Bot*\n\n' +
          'Crée des liens de tracking pour les canaux Telegram.\n\n' +
          '📋 *Commandes :*\n' +
          '• /newlink — créer un nouveau lien\n' +
          '• /template — voir le format des noms\n' +
          '• /listlinks — voir les liens récents\n' +
          '• /cancel — annuler'
        );
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
          '• `insta_iremotech_lunafd_noctis`\n' +
          '• `facebook_iremotech_lunapage_arsenne`\n\n' +
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
          await send(userId, '❌ Aucun canal configuré. Contacte l\'admin pour ajouter `LUNA_CHANNEL_ID` dans Railway.');
          continue;
        }

        // Si un seul canal configuré, skip la sélection → passe au support
        if (buttons.length === 1) {
          const canal = buttons[0].callback_data;
          userState[userId] = { step: 'waiting_support', canal };
          await send(userId, `🔗 *Nouveau lien — ${LABELS[canal]}*\n\n📱 *Quel support ?*`, {
            reply_markup: { inline_keyboard: [
              [{ text: '🔵 Ali Remote', callback_data: 'support_ali' }],
              [{ text: '🟢 Iremotech', callback_data: 'support_iremotech' }],
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
        const results = await Promise.all(
          Object.entries(CHANNELS)
            .filter(([, id]) => id)
            .map(async ([model, channelId]) => {
              const r = await api('exportChatInviteLink', { chat_id: channelId });
              return { model, link: r.ok ? r.result : 'N/A' };
            })
        );
        let msg2 = '📋 *Liens principaux :*\n\n';
        results.forEach(r => {
          const label = LABELS[r.model] || r.model;
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

      // Étapes texte
      const state = userState[userId];
      if (!state) {
        await send(userId, 'Tape /start pour voir les commandes.');
        continue;
      }

      // Étape : nom du compte (ali/iremotech flow)
      if (state.step === 'waiting_compte') {
        userState[userId] = { ...state, compte: text.replace(/\s+/g, '').toLowerCase(), step: 'waiting_va' };
        await send(userId, '🧑‍💼 *Tape le nom du VA :*\n_(ex: arsenne, noctis...)_');
        continue;
      }

      // Étape : nom du VA → génération automatique du lien
      if (state.step === 'waiting_va') {
        const va = text.replace(/\s+/g, '').toLowerCase();
        const sourceName = `${state.source}_${state.support === 'iremotech' ? 'iremotech' : 'ali'}_${state.compte}_${va}`;

        await createLink(userId, state.canal, sourceName, msg);
        continue;
      }

      // Étape : saisie libre (support "autre")
      if (state.step === 'waiting_name') {
        const sourceName = text.replace(/\s+/g, '_').toLowerCase();
        await createLink(userId, state.canal, sourceName, msg);
        continue;
      }

      await send(userId, 'Tape /start pour voir les commandes.');
      continue;

    }
  } catch (err) {
    console.error('Erreur poll:', err.message);
  }
}

async function createLink(userId, canal, sourceName, msg) {
  const channelId = CHANNELS[canal];
  try {
    const result = await api('createChatInviteLink', {
      chat_id: channelId,
      name: sourceName
    });

    if (!result.ok) throw new Error(result.description);

    const link  = result.result.invite_link;
    const label = LABELS[canal];

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
console.log('🔗 ALX Link Bot démarré');
console.log('👥 IDs autorisés:', ALLOWED_IDS.length ? ALLOWED_IDS.join(', ') : 'AUCUN — configure ALLOWED_IDS');
console.log('📢 Canaux:', Object.entries(CHANNELS).filter(([,v])=>v).map(([k])=>k).join(', ') || 'AUCUN');

setInterval(poll, 2000);
