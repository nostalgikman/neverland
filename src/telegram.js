const TelegramBot = require('node-telegram-bot-api');

let bot = null;

function initBot(token) {
  if (!token) {
    console.warn('⚠️  BOT_TOKEN manquant – les notifications ne fonctionneront pas');
    return null;
  }
  bot = new TelegramBot(token, { polling: false });
  return bot;
}

async function sendOrderNotification(adminChatId, order, productsMap) {
  if (!bot || !adminChatId) {
    console.error('Bot ou ADMIN_CHAT_ID non configuré');
    return false;
  }

  const itemsList = order.items.map(item => {
    const p = productsMap[item.id] || { name: 'Produit inconnu', image_emoji: '🎁' };
    return `${p.image_emoji} ${p.name} × ${item.qty}`;
  }).join('\n');

  const deliveryLabel = order.delivery_type === 'delivery'
    ? '🚚 Livraison'
    : '🏠 Retrait sur place';

  const addressBlock = order.delivery_type === 'delivery'
    ? `\n📍 Adresse :\n${order.address}\n👤 Pseudo Telegram : @${order.telegram_username || 'non renseigné'}`
    : `\n📌 Le client viendra chercher sur place.\n(Tu peux lui envoyer l’adresse par message privé)`;

  const pointsInfo = order.points_spent > 0
    ? `\n🎁 Points utilisés : ${order.points_spent} (article offert)`
    : '';

  const message = `
✨ *Nouvelle commande Neverland* #${order.id}

👤 Client : ${order.first_name || ''} ${order.username ? `(@${order.username})` : ''}
🆔 ID : \`${order.telegram_id}\`

📦 *Articles :*
${itemsList}

💰 Total : *${order.total.toFixed(2)} €* (paiement en espèces)
${pointsInfo}
➕ Points gagnés : +${order.points_earned}

${deliveryLabel}${addressBlock}

🕐 ${new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}
`.trim();

  try {
    await bot.sendMessage(adminChatId, message, {
      parse_mode: 'Markdown',
      disable_web_page_preview: true
    });
    return true;
  } catch (err) {
    console.error('Erreur envoi notification Telegram:', err.message);
    return false;
  }
}

module.exports = { initBot, sendOrderNotification };
