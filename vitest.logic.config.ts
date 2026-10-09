import {defineConfig} from 'vitest/config';

export default defineConfig({test:{environment:'node',include:[
  'tests/core/answer-validator.test.ts',
  'tests/core/execution-planner.test.ts',
  'tests/core/batch-planner.test.ts',
  'tests/core/batch-answer-validator.test.ts',
  'tests/core/policies.test.ts',
  'tests/core/call-reservation.test.ts',
  'tests/core/session-timer.test.ts',
  'tests/core/course-policies.test.ts',
  'tests/provider/provider-manager.test.ts',
  'tests/scripts/easycpa-acceptance-config.test.mjs',
  'tests/scripts/authorized-test-model.test.mjs',
  'tests/extension/test-notification-recorder.test.mjs',
  'tests/web/chaoxing-learning-page.test.ts',
  'tests/web/course-location.test.ts',
  'tests/extension/course-platform.test.ts',
  'tests/extension/course-cancellation.test.ts',
  'tests/extension/ui-language.test.ts',
]}});
