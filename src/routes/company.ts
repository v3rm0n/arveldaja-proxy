import { Router } from 'express';
import { forwardReadRequest } from '../utils/executor';

const router = Router();

// Get company information
router.get('/company', async (req, res) => {
  try {
    // Fetch multiple endpoints in parallel
    const [vatInfo, invoiceInfo, bankAccounts] = await Promise.all([
      forwardReadRequest('GET', '/vat_info', {}, {}),
      forwardReadRequest('GET', '/invoice_info', {}, {}),
      forwardReadRequest('GET', '/bank_accounts', {}, {}),
    ]);

    const companyInfo = {
      name: invoiceInfo.invoice_company_name || 'Unknown',
      address: invoiceInfo.address || null,
      email: invoiceInfo.email || null,
      phone: invoiceInfo.phone || null,
      fax: invoiceInfo.fax || null,
      website: invoiceInfo.webpage || null,
      vatNumber: vatInfo.vat_number || null,
      taxNumber: vatInfo.tax_refnumber || null,
      bankAccounts: bankAccounts || [],
      invoiceSettings: {
        emailSubject: invoiceInfo.invoice_email_subject || null,
        emailBody: invoiceInfo.invoice_email_body || null,
      },
    };

    res.json({ success: true, company: companyInfo });
  } catch (error) {
    console.error('Error fetching company info:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch company information',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Get account balances
router.get('/accounts', async (req, res) => {
  try {
    const accounts = await forwardReadRequest('GET', '/accounts', {}, {});
    res.json({ success: true, accounts });
  } catch (error) {
    console.error('Error fetching accounts:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch accounts',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
