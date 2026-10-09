/**
 * Out-of-process controller entry boundary. No listener/service is installed.
 * Only fixed denial output is available until an independently reviewed native service
 * and external owner+custodian roots are provisioned. No factory, override or registry.
 */
import { verifyOwnerAuthorization } from './adapters';
export function handleUntrustedRequest(_request?: unknown) {
  // Not even a getter/proxy/thenable is touched. Models and temporary stores are not imported.
  return verifyOwnerAuthorization();
}
if (typeof require !== 'undefined' && require.main === module) {
  console.log(JSON.stringify(handleUntrustedRequest()));
  process.exitCode = 2;
}
