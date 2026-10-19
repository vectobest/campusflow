import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { ApiError } from '../middleware/errors.js';
import { validate } from '../middleware/validate.js';
import { DatasetVersion } from '../models/DatasetVersion.js';
import { audit } from '../services/audit.js';
import { createDatasetVersion, listDatasets } from '../services/datasets.js';

const router = Router();
router.use(requireAuth, requireRole('researcher', 'admin'));

router.get('/', async (req, res) => {
  res.json({ data: await listDatasets() });
});

router.get('/:datasetId', async (req, res) => {
  const summary = (await listDatasets()).filter((d) => d.datasetId === req.params.datasetId);
  const versions = await DatasetVersion.find({ datasetId: req.params.datasetId }).sort({ version: -1 });
  if (summary.length === 0 && versions.length === 0) throw new ApiError(404, 'dataset_not_found', 'Dataset not found');
  res.json({ data: { summary, versions: versions.map((v) => v.toPublic()) } });
});

router.post(
  '/:datasetId/versions',
  validate(z.object({ description: z.string().max(500).default('') })),
  async (req, res) => {
    let result;
    try {
      result = await createDatasetVersion(req.params.datasetId, {
        description: req.valid.body.description,
        createdByRole: req.user.role,
      });
    } catch (err) {
      throw new ApiError(409, 'mixed_origins', err.message);
    }
    if (!result) throw new ApiError(404, 'no_finished_sessions', 'Dataset has no completed sessions to version');
    if (result.created) {
      await audit('dataset.version', {
        user: req.user,
        targetType: 'dataset',
        targetId: req.params.datasetId,
        details: { version: result.version.version, contentHash: result.version.contentHash },
      });
    }
    res.status(result.created ? 201 : 200).json({ data: result.version.toPublic(), meta: { created: result.created } });
  },
);

export default router;
