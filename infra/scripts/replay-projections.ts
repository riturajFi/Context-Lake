import { createStreamProcessor, loadStreamProcessorConfig } from '../../services/stream-processor/src/app.js';

const config = loadStreamProcessorConfig();
const processor = await createStreamProcessor({
  ...config,
  PROJECTION_REPLAY_FROM_BEGINNING: true,
});

try {
  await processor.applier.resetViews();
  processor.logger.warn('projection state cleared; starting replay from earliest offsets');
  await processor.start();
} finally {
  await processor.stop();
}
