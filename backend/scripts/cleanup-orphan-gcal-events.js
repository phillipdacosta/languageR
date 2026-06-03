/**
 * One-time backfill: delete orphaned Barnabi-authored events from tutors' Google
 * Calendars (events Barnabi created whose backing lesson no longer references
 * them). The live fetch path cleans these lazily for tutors who browse the
 * Barnabi calendar; this script clears the existing backlog for everyone,
 * including tutors who only ever look at Google directly.
 *
 * Usage:
 *   node scripts/cleanup-orphan-gcal-events.js --dry-run          # report only
 *   node scripts/cleanup-orphan-gcal-events.js                    # delete
 *   node scripts/cleanup-orphan-gcal-events.js --email=foo@x.com  # single tutor
 *
 * Safe to re-run: idempotent and self-extinguishing.
 */
const mongoose = require('mongoose');
require('dotenv').config({ path: './config.env' });

const User = require('../models/User');
const { reconcileOrphansForUser } = require('../services/googleCalendarService');

const DRY_RUN = process.argv.includes('--dry-run');
const EMAIL_ARG = process.argv.find(a => a.startsWith('--email='));
const ONLY_EMAIL = EMAIL_ARG ? EMAIL_ARG.split('=')[1] : null;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI not set (check config.env)');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`Connected. dryRun=${DRY_RUN}${ONLY_EMAIL ? ` email=${ONLY_EMAIL}` : ''}\n`);

  const query = { 'googleCalendar.connected': true };
  if (ONLY_EMAIL) query.email = ONLY_EMAIL;

  const tutors = await User.find(query).select('_id email').lean();
  console.log(`Found ${tutors.length} connected tutor(s).\n`);

  const totals = { scanned: 0, orphanCount: 0, deleted: 0, skipped: 0, errored: 0 };

  for (const t of tutors) {
    try {
      const r = await reconcileOrphansForUser(t._id, { dryRun: DRY_RUN });
      if (r.skipped) {
        totals.skipped++;
        console.log(`- ${t.email}: skipped (${r.reason})`);
      } else {
        totals.scanned += r.scanned;
        totals.orphanCount += r.orphanCount;
        totals.deleted += r.deleted;
        console.log(`- ${t.email}: scanned=${r.scanned} orphans=${r.orphanCount} deleted=${r.deleted}`);
      }
    } catch (e) {
      totals.errored++;
      console.warn(`- ${t.email}: error ${e.message}`);
    }
    // Gentle spacing between tutors so a large run stays under API quotas.
    await sleep(500);
  }

  console.log(
    `\nDONE. tutors=${tutors.length} scanned=${totals.scanned} ` +
    `orphans=${totals.orphanCount} deleted=${totals.deleted} ` +
    `skipped=${totals.skipped} errored=${totals.errored} dryRun=${DRY_RUN}`
  );
  await mongoose.connection.close();
}

main().catch(e => { console.error(e); process.exit(1); });
