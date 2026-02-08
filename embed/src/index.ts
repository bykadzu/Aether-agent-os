/**
 * Aether Embed - Entry Point
 *
 * Registers the <aether-agent> custom element for embedding
 * Aether OS agent chat widgets on any website.
 */

import { AetherAgentElement } from './AetherAgentElement.js';

if (!customElements.get('aether-agent')) {
  customElements.define('aether-agent', AetherAgentElement);
}

export { AetherAgentElement };
