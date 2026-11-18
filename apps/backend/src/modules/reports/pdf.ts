import { renderAgencyReport } from '@daybook/ui/reports';
import { reserveDocumentRenderer } from '../documents/engine.js';
import type { AgencyReportSnapshot } from './model.js';

/** Reports share the existing bounded, offline-only Chromium renderer and embedded font assets. */
export function reserveReportRenderer() {
  const renderer = reserveDocumentRenderer();
  if (!renderer) return null;
  let released = false;
  return {
    release() {
      if (!released) {
        released = true;
        renderer.release();
      }
    },
    async render(snapshot: AgencyReportSnapshot): Promise<Buffer> {
      try {
        return await renderer.renderHtml(
          renderAgencyReport(snapshot),
          snapshot.locale,
          'Daybook report',
        );
      } finally {
        this.release();
      }
    },
  };
}
