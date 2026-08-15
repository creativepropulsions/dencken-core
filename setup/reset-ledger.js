#!/usr/bin/env node
const ledger = require('../../src/core/ledger');
(async () => {
  try {
    let count = 0;
    if (typeof ledger.getLedgerHeight === 'function') {
      count = await ledger.getLedgerHeight();
    } else if (typeof ledger.readFallbackEntries === 'function') {
      const entries = ledger.readFallbackEntries({ limit: 1000, offset: 0 });
      count = entries.length;
    }

    if (count > 0) {
      console.log('Ledger is not empty (entries:', count, '). Reset aborted.');
      process.exit(1);
    }

    if (typeof ledger.resetLedgerStorage !== 'function') {
      console.log('Reset operation not supported in this ledger implementation.');
      process.exit(1);
    }

    await ledger.resetLedgerStorage();
    console.log('Ledger storage reset successfully.');
    process.exit(0);
  } catch (err) {
    console.error('Failed to reset ledger:', err.message);
    process.exit(1);
  }
})();
