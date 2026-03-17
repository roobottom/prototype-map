import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import yaml from 'js-yaml';
import Ajv from 'ajv';

const schema = {
  type: 'object',
  required: ['name', 'baseUrl', 'pages'],
  properties: {
    name: { type: 'string' },
    description: { type: 'string' },
    baseUrl: { type: 'string' },
    viewport: {
      type: 'object',
      properties: {
        width: { type: 'number', default: 1280 },
        height: { type: 'number', default: 900 }
      }
    },
    round: { type: 'number', default: 1 },
    pages: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['id', 'path'],
        properties: {
          id: { type: 'string' },
          path: { type: 'string' },
          label: { type: 'string' },
          states: {
            type: 'array',
            items: {
              type: 'object',
              required: ['id'],
              properties: {
                id: { type: 'string' },
                label: { type: 'string' },
                params: { type: 'object' },
                cookies: { type: 'object' },
                setup: { type: 'string' },
                formData: {
                  type: 'array',
                  items: {
                    type: 'object',
                    required: ['field'],
                    properties: {
                      field: { type: 'string' },
                      value: { type: 'string' },
                      action: { type: 'string', enum: ['check', 'uncheck', 'select', 'click'] }
                    }
                  }
                },
                submit: { type: ['boolean', 'string'], default: false }
              }
            }
          }
        }
      }
    },
    journeys: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'steps'],
        properties: {
          id: { type: 'string' },
          label: { type: 'string' },
          steps: {
            type: 'array',
            items: {
              type: 'object',
              required: ['from', 'to'],
              properties: {
                from: { type: 'string' },
                to: { type: 'string' },
                label: { type: 'string' },
                fromState: { type: 'string' },
                toState: { type: 'string' }
              }
            }
          }
        }
      }
    }
  }
};

const ajv = new Ajv({ useDefaults: true, allErrors: true, allowUnionTypes: true });
const validate = ajv.compile(schema);

/**
 * Load and validate a prototype-map config file.
 */
export function loadConfig(configPath) {
  const fullPath = resolve(configPath);
  let raw;
  try {
    raw = readFileSync(fullPath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(`Config file not found: ${fullPath}`);
    }
    throw err;
  }

  const config = yaml.load(raw);

  if (!validate(config)) {
    const errors = validate.errors.map(e => `  ${e.instancePath || '/'}: ${e.message}`).join('\n');
    throw new Error(`Invalid config:\n${errors}`);
  }

  // Apply defaults
  config.viewport = config.viewport || { width: 1280, height: 900 };
  config.round = config.round || 1;
  config.journeys = config.journeys || [];

  return config;
}

/**
 * Write a config object to a YAML file.
 */
export function writeConfig(configPath, config) {
  const fullPath = resolve(configPath);
  const yamlStr = yaml.dump(config, {
    lineWidth: -1,
    noRefs: true,
    quotingType: '"',
    forceQuotes: false
  });
  writeFileSync(fullPath, yamlStr, 'utf8');
  return fullPath;
}
