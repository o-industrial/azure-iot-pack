import { AzureIoTHubDataConnection } from '../src/sop/AzureIoTHubDataConnection.ts';
import { assertEquals } from './tests.deps.ts';

Deno.test('Azure IoT pack exports data connection builder', () => {
  assertEquals(typeof AzureIoTHubDataConnection, 'function');
});
