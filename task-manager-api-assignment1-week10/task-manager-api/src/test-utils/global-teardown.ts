/**
 * W1: Jest global teardown — cleanup after all tests complete.
 */
export default async function globalTeardown(): Promise<void> {
  console.log('✅ Global teardown complete');
}
