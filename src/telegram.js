const TelegramBot = require('node-telegram-bot-api');
let bot = null;

function initBot(token) {
  if (!token) {
    console.warn('⚠️  BOT_TOKEN manquant');
    return null;
  }
  bot = new TelegramBot(token, { polling: false });
  return bot;
}

async function sendOrderNotification(adminChatId, order, productsMap) {
  if (!bot || !adminChatId) return false;

  const itemsList = order.items.map(item => {
    const p = productsMap[item.id] || {};
    return `${p.image_emoji || '🎁'} ${item.name} — ${item.offer_label || ''} ×${item.count || 1} — ${(item.line_total || 0).toFixed(2)} €`;
  }).join('\n');

  const deliveryLabel = order.delivery_type === 'delivery' ? '🚚 Livraison' : '🏠 Retrait sur place';
  const feeLine = order.delivery_fee ? `\n📦 Frais de livraison : ${Number(order.delivery_fee).toFixed(2)} €` : '';
  const addressBlock = order.delivery_type === 'delivery'
    ? `\n📍 Adresse :\n${order.address}\n👤 Pseudo Telegram : @${order.telegram_username || 'non renseigné'}`
    : `\n📌 Retrait sur place`;

  const message = `
✨ *Nouvelle commande Neverland* #${order.id}

👤 Client : ${order.first_name || ''} ${order.username ? `(@${order.username})` : ''}
🆔 ID : \`${order.telegram_id}\`

📦 *Articles :*
${itemsList}
${feeLine}

💰 Total : *${order.total.toFixed(2)} €* (espèces)

${deliveryLabel}${addressBlock}

🕐 ${new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}
`.trim();

  try {
    await bot.sendMessage(adminChatId, message, { parse_mode: 'Markdown', disable_web_page_preview: true });
    return true;
  } catch (err) {
    console.error('Erreur notification:', err.message);
    return false;
  }
}

module.exports = { initBot, sendOrderNotification };
