import { defineToolPlugin } from 'openclaw/plugin-sdk/tool-plugin';
import { jsonResult } from 'openclaw/plugin-sdk/tool-results';

import { readGlintex, type ReadParameters, type TrustedToolContext } from './client.js';
import { pluginConfigSchema, readParameters } from './tool-schemas.js';

const description =
  'Read live GLINTEX production data for the authenticated owner only. Use resource=reference before resolving master IDs or interpreting controlled values. Supported reads are bounded to health, masters, issues, receives, on-machine work, stock, production, barcode lineage, and contractor settlements. This tool cannot create, update, delete, attach, deploy, message, or self-modify.';

export default defineToolPlugin({
  id: 'glintex-readonly',
  name: 'GLINTEX Read Only',
  description: 'Owner-only, bounded read access for the dedicated GLINTEX companion.',
  configSchema: pluginConfigSchema,
  tools: tool => [
    tool({
      name: 'glintex_read',
      label: 'Read GLINTEX',
      description,
      parameters: readParameters,
      factory({ config, toolContext }) {
        return {
          name: 'glintex_read',
          label: 'Read GLINTEX',
          description,
          parameters: readParameters,
          async execute(
            _toolCallId: string,
            rawParams: unknown,
            signal?: AbortSignal,
          ) {
            return jsonResult(
              await readGlintex(
                rawParams as ReadParameters,
                config,
                toolContext as TrustedToolContext,
                signal,
              ),
            );
          },
        };
      },
    }),
  ],
});
