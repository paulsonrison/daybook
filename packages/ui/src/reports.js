const escape = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
/** Labels and exact recorded values are frozen by the caller; presentation performs no business calculations. */
export function renderAgencyReport(model) {
  return `<article class="db-document db-report" lang="${escape(model.locale)}"><header><p>${escape(model.agencyName)}</p><h1>${escape(model.title)}</h1><p>${escape(model.reference)}</p>${model.meta.map((row) => `<p><strong>${escape(row.label)}</strong> ${escape(row.value)}</p>`).join('')}</header>${model.notes.map((note) => `<p>${escape(note)}</p>`).join('')}${model.sections.map((section) => `<section><h2>${escape(section.title)}</h2><table><thead><tr>${section.columns.map((label) => `<th scope="col">${escape(label)}</th>`).join('')}</tr></thead><tbody>${section.rows.map((row) => `<tr>${row.map((cell) => `<td>${escape(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></section>`).join('')}</article>`;
}
