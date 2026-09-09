import { Router } from 'express';
import { PracticeController } from '../controllers/practiceController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router({ mergeParams: true });

router.use(requireAuth);

router.post('/:id/practice/confidence', PracticeController.updateConfidence);
router.post('/:id/practice/mock-evaluate', PracticeController.mockEvaluate);

export default router;
