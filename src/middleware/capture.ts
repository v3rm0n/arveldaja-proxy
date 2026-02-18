import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { createPendingChange, createChangeset } from '../db';
import { Changeset } from '../types';

// HTTP methods that modify data and require approval
const WRITE_METHODS = ['POST', 'PATCH', 'PUT', 'DELETE'];

export function isWriteOperation(method: string): boolean {
  return WRITE_METHODS.includes(method.toUpperCase());
}

export function captureMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Only capture write operations
  if (!isWriteOperation(req.method)) {
    return next();
  }

  // Generate unique ID for this change
  const changeId = uuidv4();
  
  // Store change ID on request for later use
  (req as any).changeId = changeId;

  // Get changeset ID from headers if provided
  let changesetId = req.headers['x-changeset-id'] as string | undefined;

  // Use the already-parsed body from express.json()
  const body = req.body ? JSON.stringify(req.body) : null;
  
  // Helper function to create the change
  const doCreateChange = (finalChangesetId: string) => {
    createPendingChange({
      id: changeId,
      changesetId: finalChangesetId,
      method: req.method,
      path: req.path,
      originalUrl: req.originalUrl,
      headers: Object.fromEntries(
        Object.entries(req.headers).map(([k, v]) => [k, String(v)])
      ),
      body: body,
      query: req.query as Record<string, string>,
      status: 'pending',
      createdAt: new Date().toISOString(),
      resolvedAt: null,
      resolvedBy: null,
      response: null,
      error: null,
    }).then(() => {
      console.log(`Captured ${req.method} ${req.path} as change ${changeId} in changeset ${finalChangesetId}`);
      
      // Return 202 Accepted with info about pending approval
      res.status(202).json({
        success: true,
        message: 'Change captured and pending approval',
        changeId,
        changesetId: finalChangesetId,
        status: 'pending',
        reviewUrl: `/review/${changeId}`,
      });
    }).catch((error) => {
      console.error('Failed to capture change:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to capture change for approval',
      });
    });
  };
  
  // If no changeset ID provided, auto-create a single-change changeset
  if (!changesetId) {
    const autoChangesetId = uuidv4();
    const changeset: Changeset = {
      id: autoChangesetId,
      name: `Change ${new Date().toLocaleString()}`,
      description: `Auto-created changeset for single change`,
      status: 'pending',
      createdAt: new Date().toISOString(),
      resolvedAt: null,
      resolvedBy: null,
    };
    
    createChangeset(changeset).then(() => {
      doCreateChange(autoChangesetId);
    }).catch((error) => {
      console.error('Failed to create auto-changeset:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to create changeset for change',
      });
    });
  } else {
    doCreateChange(changesetId);
  }
}

export function getChangeId(req: Request): string | undefined {
  return (req as any).changeId;
}
