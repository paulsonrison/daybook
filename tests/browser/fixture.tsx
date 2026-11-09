import React from 'react';
import { createRoot } from 'react-dom/client';
import { Theme, Notification, Tooltip } from '../../packages/ui/src/index';
import '../../packages/ui/src/styles.css';

const mode =
  new URLSearchParams(location.search).get('mode') === 'dark'
    ? 'dark'
    : 'system';
createRoot(document.getElementById('root')!).render(
  <Theme mode={mode}>
    <div style={{ padding: 64 }}>
      {(['info', 'success', 'warning', 'error'] as const).map((tone) => (
        <Notification
          key={tone}
          tone={tone}
          title={tone}
          description="Preserved work and recovery details"
        />
      ))}
      <Tooltip content="A longer explanation that stays visible while the pointer reads the tooltip.">
        <button>Explain</button>
      </Tooltip>
    </div>
  </Theme>,
);
