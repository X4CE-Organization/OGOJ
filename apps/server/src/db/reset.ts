/** Drop every record and re-seed the database. */
import { seed, wipe } from './seed.js';
import { invalidateSettings } from '../settings/index.js';

async function main() {
  console.log('Wiping all data...');
  wipe();
  invalidateSettings();
  await seed();
  console.log('Database reset complete.');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
