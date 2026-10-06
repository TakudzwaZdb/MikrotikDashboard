// Optional push alerts. Configure ONE OR MORE channels in .env; with none configured this does nothing.
//   NOTIFY_TELEGRAM_TOKEN + NOTIFY_TELEGRAM_CHAT   Telegram bot (free)
//   NOTIFY_WEBHOOK_URL                             any GET URL containing {text}, e.g. a WhatsApp gateway such as CallMeBot:
//                                                  https://api.callmebot.com/whatsapp.php?phone=2637XXXXXXXX&apikey=KEY&text={text}
import { config } from '../config/index.js';

export const channels = () => [config.notify.telegramToken && config.notify.telegramChat && 'telegram', config.notify.webhookUrl && 'webhook'].filter(Boolean);

export async function notify(text) {
  const n = config.notify, msg = `EWZ Network Center: ${text}`, out = [];
  const t = ms => ({ signal: AbortSignal.timeout(ms) });
  if (n.telegramToken && n.telegramChat) out.push(fetch(`https://api.telegram.org/bot${n.telegramToken}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: n.telegramChat, text: msg }), ...t(10000) }).then(r => { if (!r.ok) throw new Error(`telegram ${r.status}`); }));
  if (n.webhookUrl) out.push(fetch(n.webhookUrl.replace('{text}', encodeURIComponent(msg)), t(10000)).then(r => { if (!r.ok) throw new Error(`webhook ${r.status}`); }));
  const res = await Promise.allSettled(out);
  res.filter(r => r.status === 'rejected').forEach(r => console.error('notify failed:', r.reason?.message));
  return res.length;
}
