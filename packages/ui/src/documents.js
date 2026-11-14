import { formatMoney } from './money.js';
const escape = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
/** Business amounts, labels and statuses are supplied by the caller, never inferred here. */
export function renderFinancialDocument(model) {
  const money = (value) =>
    escape(formatMoney(value, 'INR', `${model.locale}-IN`));
  const qr =
    typeof model.qrDataUrl === 'string' &&
    model.qrDataUrl.length <= 200000 &&
    /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(model.qrDataUrl)
      ? `<img width="192" height="192" src="${model.qrDataUrl}" alt="UPI QR"/>`
      : '';
  const uri =
    typeof model.upiUri === 'string' && model.upiUri.startsWith('upi://pay?')
      ? `<a href="${escape(model.upiUri)}">UPI</a>`
      : '';
  return `<article class="db-document db-card db-bill"><div class="db-stack">
 <header class="db-bill-header"><div><p class="db-eyebrow">${escape(model.agencyName)}</p><h1 class="db-bill-name">${escape(model.title)}</h1><strong>${escape(model.reference)}</strong></div><div class="db-bill-meta">${model.meta.map((m) => `<p><strong>${escape(m.label)}</strong> ${escape(m.value)}</p>`).join('')}</div></header>
 <section><h2>${escape(model.subject.name)}</h2><p>${escape(model.subject.reference)}</p><p>${escape(model.subject.address)}</p></section>
 <table><thead><tr>${model.columns.map((c) => `<th>${escape(c)}</th>`).join('')}</tr></thead><tbody>${model.lines.map((l) => `<tr><td>${escape(l.description)}</td><td>${escape(l.quantity ?? '—')}</td><td>${l.rate === null ? '—' : money(l.rate)}</td><td>${money(l.amount)}</td></tr>`).join('')}</tbody></table>
 <div class="db-bill-totals">${model.totals.map((t) => `<div class="db-bill-total-row"><span>${escape(t.label)}</span><strong>${money(t.amount)}</strong></div>`).join('')}</div>
 ${model.note ? `<p class="db-document-note">${escape(model.note)}</p>` : ''}
 ${qr ? `<section class="db-document-payment">${qr}${uri}</section>` : ''}
 <footer class="db-bill-meta">${escape(model.footer)}</footer></div></article>`;
}
