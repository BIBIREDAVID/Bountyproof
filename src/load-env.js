import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const loadedPaths = new Set();

export function loadEnvFile(customPath = '') {
  const candidates = [];
  if (customPath) {
    candidates.push(customPath);
  } else {
    candidates.push(
      path.resolve(process.cwd(), '.env'),
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.env')
    );
  }

  for (const candidate of candidates) {
    const normalized = path.resolve(candidate);
    if (loadedPaths.has(normalized) || !existsSync(normalized)) {
      continue;
    }

    const content = readFileSync(normalized, 'utf8');
    parseEnv(content).forEach(({ key, value }) => {
      if (!Object.prototype.hasOwnProperty.call(process.env, key)) {
        process.env[key] = value;
      }
    });

    loadedPaths.add(normalized);
  }
}

function parseEnv(content) {
  return String(content || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const raw = line.startsWith('export ') ? line.slice(7).trim() : line;
      const index = raw.indexOf('=');
      if (index === -1) {
        return null;
      }
      const key = raw.slice(0, index).trim();
      if (!key) {
        return null;
      }
      let value = raw.slice(index + 1);
      value = stripInlineComment(value).trim();
      value = unquote(value);
      return { key, value };
    })
    .filter(Boolean);
}

function stripInlineComment(value) {
  let quote = null;
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (quote) {
      if (char === quote && value[i - 1] !== '\\') {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '#') {
      return value.slice(0, i);
    }
  }
  return value;
}

function unquote(value) {
  const trimmed = String(value || '').trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    const inner = trimmed.slice(1, -1);
    if (trimmed.startsWith('"')) {
      return inner.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
    return inner.replace(/\\'/g, "'").replace(/\\\\/g, '\\');
  }
  return trimmed;
}

loadEnvFile();
