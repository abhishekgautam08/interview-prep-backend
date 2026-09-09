import { Router } from 'express';
import { KitController } from '../controllers/kitController.js';
import { requireAuth } from '../middleware/auth.js';
import { kitGenerationLimiter } from '../middleware/rateLimiter.js';

const router = Router();

router.use(requireAuth);

router.post('/generate', kitGenerationLimiter, KitController.generate);
router.get('/generate/stream', kitGenerationLimiter, KitController.streamGenerate);
router.get('/', KitController.list);
router.get('/:id', KitController.get);
router.put('/:id', KitController.update);
router.delete('/:id', KitController.delete);

// Section 6: Isolated regeneration endpoints
router.post('/:id/regenerate-category', KitController.regenerateCategory);
router.post('/:id/regenerate-brief', KitController.regenerateBrief);
router.post('/:id/regenerate-schedule', KitController.regenerateSchedule);

export default router;
