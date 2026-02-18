#!/usr/bin/env node

/**
 * Demo script to test the e-arveldaja Proxy
 * 
 * This demonstrates how AI agents would interact with the proxy
 */

const BASE_URL = 'http://localhost:3000';

async function demo() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║           e-arveldaja Proxy Demo                         ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  // 1. Test reading (should work freely)
  console.log('1. Testing READ operation (accounts)...');
  try {
    // Note: This will fail without valid credentials, but demonstrates the flow
    const readRes = await fetch(`${BASE_URL}/proxy/v1/accounts`, {
      headers: {
        'X-AUTH-QUERYTIME': new Date().toISOString().replace(/\.\d{3}Z$/, ''),
        'X-AUTH-KEY': 'demo_key:demo_signature',
      },
    });
    
    if (readRes.status === 401) {
      console.log('   ✓ Read request forwarded to API (returned 401 - expected without valid credentials)\n');
    } else {
      const data = await readRes.json();
      console.log('   ✓ Read successful:', JSON.stringify(data).slice(0, 100) + '...\n');
    }
  } catch (err) {
    console.log('   ✗ Error:', err.message, '\n');
  }

  // 2. Test writing (should be captured)
  console.log('2. Testing WRITE operation (create journal)...');
  try {
    const writeRes = await fetch(`${BASE_URL}/proxy/v1/journals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-AUTH-QUERYTIME': new Date().toISOString().replace(/\.\d{3}Z$/, ''),
        'X-AUTH-KEY': 'demo_key:demo_signature',
      },
      body: JSON.stringify({
        no: 'DEMO-001',
        effective_date: '2024-01-15',
        description: 'Demo journal entry',
        type: 'MANUAL',
        transactions: [
          {
            debit_account: '6000',
            credit_account: '2030',
            amount: '1000.00',
            description: 'Demo transaction',
          },
        ],
      }),
    });
    
    const writeData = await writeRes.json();
    console.log('   ✓ Write captured:', writeData.message);
    console.log('   → Change ID:', writeData.changeId);
    console.log('   → Review at:', `${BASE_URL}${writeData.reviewUrl}\n`);

    // 3. Check pending changes
    console.log('3. Checking pending changes...');
    const changesRes = await fetch(`${BASE_URL}/api/changes?status=pending`);
    const changesData = await changesRes.json();
    
    if (changesData.success && changesData.changes.length > 0) {
      console.log(`   ✓ Found ${changesData.changes.length} pending change(s)\n`);
      
      // 4. Show stats
      console.log('4. Getting statistics...');
      const statsRes = await fetch(`${BASE_URL}/api/stats`);
      const statsData = await statsRes.json();
      
      if (statsData.success) {
        console.log('   Stats:');
        console.log(`   - Pending:  ${statsData.stats.pending}`);
        console.log(`   - Approved: ${statsData.stats.approved}`);
        console.log(`   - Rejected: ${statsData.stats.rejected}`);
        console.log(`   - Total:    ${statsData.stats.total}\n`);
      }
      
      console.log('╔══════════════════════════════════════════════════════════╗');
      console.log('║  Open your browser to review the change:                 ║');
      console.log(`║  ${BASE_URL}/review                                       ║`);
      console.log('╚══════════════════════════════════════════════════════════╝\n');
      
    } else {
      console.log('   ✗ No pending changes found\n');
    }
    
  } catch (err) {
    console.log('   ✗ Error:', err.message, '\n');
  }
}

demo().catch(console.error);
