import { assertEquals } from './tests.deps.ts';
import { AzureIoTHubDataConnection } from '../mod.ts';

Deno.test('Azure IoT pack exports data connection builder', () => {
  assertEquals(typeof AzureIoTHubDataConnection, 'function');
});
