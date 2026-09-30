import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./tests/e2e', fullyParallel:false, workers:1, timeout:30_000,
  use:{browserName:'chromium',channel:'chrome',headless:true,reducedMotion:'reduce',viewport:{width:1440,height:1000},screenshot:'only-on-failure',trace:'retain-on-failure'},
  reporter:'list',outputDir:'test-results/research',
});
