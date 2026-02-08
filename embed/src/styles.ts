/**
 * Aether Embed - Styles
 *
 * All CSS is scoped inside shadow DOM to prevent leaking.
 * Supports dark and light themes.
 */

export function getStyles(theme: 'dark' | 'light' = 'dark'): string {
  const dark = theme === 'dark';
  const bg = dark ? '#1a1a2e' : '#ffffff';
  const bgPanel = dark ? '#16213e' : '#f5f5f7';
  const text = dark ? '#e0e0ff' : '#1a1a2e';
  const textSecondary = dark ? '#8888aa' : '#666680';
  const accent = '#4a4aff';
  const accentHover = '#5c5cff';
  const userBubble = dark ? '#3a3a8f' : '#4a4aff';
  const userBubbleText = '#ffffff';
  const agentBubble = dark ? '#2a2a4a' : '#e8e8f0';
  const agentBubbleText = dark ? '#e0e0ff' : '#1a1a2e';
  const border = dark ? '#2a2a5e' : '#d0d0e0';
  const inputBg = dark ? '#0e1528' : '#ffffff';
  const shadow = dark ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.15)';

  return `
    :host {
      all: initial;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      color: ${text};
    }

    #aether-widget-root {
      position: fixed;
      z-index: 999999;
    }

    #aether-widget-root.bottom-right { bottom: 20px; right: 20px; }
    #aether-widget-root.bottom-left { bottom: 20px; left: 20px; }
    #aether-widget-root.top-right { top: 20px; right: 20px; }
    #aether-widget-root.top-left { top: 20px; left: 20px; }

    .aether-fab {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: ${accent};
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 16px ${shadow};
      transition: transform 0.2s, box-shadow 0.2s;
    }

    .aether-fab:hover {
      transform: scale(1.08);
      box-shadow: 0 6px 24px ${shadow};
      background: ${accentHover};
    }

    .aether-fab svg {
      width: 28px;
      height: 28px;
      fill: #ffffff;
    }

    .aether-panel {
      width: 400px;
      height: 560px;
      background: ${bg};
      border: 1px solid ${border};
      border-radius: 12px;
      box-shadow: 0 8px 32px ${shadow};
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .aether-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      background: ${bgPanel};
      border-bottom: 1px solid ${border};
    }

    .aether-header span {
      font-weight: 600;
      font-size: 15px;
      color: ${text};
    }

    .aether-header .minimize {
      background: none;
      border: none;
      color: ${textSecondary};
      cursor: pointer;
      font-size: 20px;
      padding: 0 4px;
      line-height: 1;
    }

    .aether-header .minimize:hover {
      color: ${text};
    }

    .aether-messages {
      flex: 1;
      overflow-y: auto;
      padding: 12px 16px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .aether-message {
      max-width: 85%;
      padding: 8px 12px;
      border-radius: 12px;
      line-height: 1.4;
      word-wrap: break-word;
      font-size: 13px;
    }

    .aether-message.user {
      align-self: flex-end;
      background: ${userBubble};
      color: ${userBubbleText};
      border-bottom-right-radius: 4px;
    }

    .aether-message.agent {
      align-self: flex-start;
      background: ${agentBubble};
      color: ${agentBubbleText};
      border-bottom-left-radius: 4px;
    }

    .aether-message.system {
      align-self: center;
      color: ${textSecondary};
      font-size: 12px;
      font-style: italic;
    }

    .aether-input-bar {
      display: flex;
      padding: 8px 12px;
      gap: 8px;
      border-top: 1px solid ${border};
      background: ${bgPanel};
    }

    .aether-input-bar input {
      flex: 1;
      padding: 8px 12px;
      border: 1px solid ${border};
      border-radius: 8px;
      background: ${inputBg};
      color: ${text};
      font-size: 13px;
      outline: none;
    }

    .aether-input-bar input:focus {
      border-color: ${accent};
    }

    .aether-input-bar input::placeholder {
      color: ${textSecondary};
    }

    .aether-input-bar .send {
      width: 36px;
      height: 36px;
      border-radius: 8px;
      background: ${accent};
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #ffffff;
      font-size: 16px;
      transition: background 0.15s;
    }

    .aether-input-bar .send:hover {
      background: ${accentHover};
    }

    @media (max-width: 480px) {
      .aether-panel {
        width: calc(100vw - 24px);
        height: calc(100vh - 100px);
        border-radius: 12px;
      }
    }
  `;
}
