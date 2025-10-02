import { Selector } from 'testcafe';

const BASE_URL = process.env.TESTCAFE_BASE_URL || 'http://localhost:8000';

fixture`DnsCheck App`.page`${BASE_URL}`;

test('runs a DNS check and shows success results', async (t) => {
  const domainInput = Selector('#domainInput');
  const startButton = Selector('#startButton');
  const connectionStatus = Selector('#connectionStatus');
  const resultRows = Selector('.dns-result-row');
  const successStatus = Selector('.dns-result-status.is-success');

  await t
    .typeText(domainInput, 'wasmer.app', { paste: true, replace: true })
    .click(startButton);

  await t.expect(connectionStatus.hasClass('is-hidden')).ok('Connection banner should remain hidden without errors', { timeout: 5000 });
  await t.expect(resultRows.exists).ok('Expected at least one provider row to render', { timeout: 30000 });
  await t.expect(successStatus.exists).ok('Expected at least one successful provider result', { timeout: 60000 });
});
