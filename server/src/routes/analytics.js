import { Router } from 'express';
import mongoose from 'mongoose';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { ApiError } from '../middleware/errors.js';

/**
 * Read-only access to aggregate results written by the Python analytics
 * service (`python -m campusflow`). Results contain no participant or session
 * identifiers; small groups are already suppressed by the pipeline.
 */
const router = Router();
router.use(requireAuth, requireRole('researcher', 'admin'));

const results = () => mongoose.connection.db.collection('analyticsresults');

router.get('/results', async (req, res) => {
  const rows = await results()
    .aggregate([
      { $sort: { generatedAt: -1 } },
      {
        $group: {
          _id: '$datasetId',
          dataOrigin: { $first: '$dataOrigin' },
          generatedAt: { $first: '$generatedAt' },
          algorithmVersion: { $first: '$algorithmVersion' },
          runs: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ])
    .toArray();
  res.json({ data: rows.map(({ _id, ...r }) => ({ datasetId: _id, ...r })) });
});

router.get('/results/:datasetId', async (req, res) => {
  const doc = await results().find({ datasetId: req.params.datasetId }, { projection: { _id: 0 } }).sort({ generatedAt: -1 }).limit(1).next();
  if (!doc) throw new ApiError(404, 'no_results', 'No analysis has been run for this dataset yet');
  res.json({ data: doc });
});

export default router;
