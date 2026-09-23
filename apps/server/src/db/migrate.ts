import { migrate } from './index.js';
import { SETTINGS } from '../settings/registry.js';

migrate();
console.log(`Schema is up to date. ${SETTINGS.length} configurable settings registered.`);
process.exit(0);
