import { Router } from 'express';
import { getPendingChanges, getPendingChangeById, updatePendingChangeStatus, deletePendingChange } from '../db';
import { isWriteOperation } from '../middleware/capture';
import { executeChange } from '../utils/executor';

const router = Router();

// List all pending changes
router.get('/changes', async (req, res) => {
  try {
    const status = req.query.status as 'pending' | 'approved' | 'rejected' | undefined;
    const changes = await getPendingChanges(status);
    res.json({ success: true, changes });
  } catch (error) {
    console.error('Error fetching changes:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch changes' });
  }
});

// Get a specific change
router.get('/changes/:id', async (req, res) => {
  try {
    const change = await getPendingChangeById(req.params.id);
    if (!change) {
      return res.status(404).json({ success: false, error: 'Change not found' });
    }
    res.json({ success: true, change });
  } catch (error) {
    console.error('Error fetching change:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch change' });
  }
});

// Approve a change
router.post('/changes/:id/approve', async (req, res) => {
  try {
    const change = await getPendingChangeById(req.params.id);
    if (!change) {
      return res.status(404).json({ success: false, error: 'Change not found' });
    }
    
    if (change.status !== 'pending') {
      return res.status(400).json({ 
        success: false, 
        error: `Change is already ${change.status}` 
      });
    }
    
    const resolvedBy = req.body.resolvedBy || 'system';
    
    // Execute the change
    const result = await executeChange(change);
    
    // Update status
    await updatePendingChangeStatus(
      change.id,
      'approved',
      resolvedBy,
      JSON.stringify(result)
    );
    
    res.json({ 
      success: true, 
      message: 'Change approved and executed',
      result,
    });
  } catch (error) {
    console.error('Error approving change:', error);
    
    // Update status with error
    await updatePendingChangeStatus(
      req.params.id,
      'rejected',
      req.body.resolvedBy || 'system',
      undefined,
      error instanceof Error ? error.message : 'Unknown error'
    );
    
    res.status(500).json({ 
      success: false, 
      error: 'Failed to approve change',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Reject a change
router.post('/changes/:id/reject', async (req, res) => {
  try {
    const change = await getPendingChangeById(req.params.id);
    if (!change) {
      return res.status(404).json({ success: false, error: 'Change not found' });
    }
    
    if (change.status !== 'pending') {
      return res.status(400).json({ 
        success: false, 
        error: `Change is already ${change.status}` 
      });
    }
    
    const resolvedBy = req.body.resolvedBy || 'system';
    const reason = req.body.reason;
    
    await updatePendingChangeStatus(
      change.id,
      'rejected',
      resolvedBy,
      undefined,
      reason
    );
    
    res.json({ 
      success: true, 
      message: 'Change rejected',
    });
  } catch (error) {
    console.error('Error rejecting change:', error);
    res.status(500).json({ success: false, error: 'Failed to reject change' });
  }
});

// Delete a change
router.delete('/changes/:id', async (req, res) => {
  try {
    await deletePendingChange(req.params.id);
    res.json({ success: true, message: 'Change deleted' });
  } catch (error) {
    console.error('Error deleting change:', error);
    res.status(500).json({ success: false, error: 'Failed to delete change' });
  }
});

// Get statistics
router.get('/stats', async (req, res) => {
  try {
    const pending = await getPendingChanges('pending');
    const approved = await getPendingChanges('approved');
    const rejected = await getPendingChanges('rejected');
    
    res.json({
      success: true,
      stats: {
        pending: pending.length,
        approved: approved.length,
        rejected: rejected.length,
        total: pending.length + approved.length + rejected.length,
      },
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch stats' });
  }
});

export default router;
