const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const today = new Date().toISOString().slice(0, 10);

let failures = 0;

function check(label, condition) {
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${label}`);
  if (!condition) failures += 1;
}

async function api(method, path, token, body) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

function tally(responses) {
  const counts = {};
  for (const { status } of responses) {
    counts[status] = (counts[status] || 0) + 1;
  }
  return counts;
}

async function createAccount(token, name, startingFunds) {
  const created = await api('POST', '/api/accounts', token, { name, type: 'cash' });
  if (created.status !== 201) {
    throw new Error(`could not create account: ${JSON.stringify(created.data)}`);
  }
  if (startingFunds) {
    const funded = await api('POST', '/api/transactions', token, {
      accountId: created.data.id,
      type: 'income',
      amount: startingFunds,
      date: today,
      description: 'Opening funds',
    });
    if (funded.status !== 201) {
      throw new Error(`could not fund account: ${JSON.stringify(funded.data)}`);
    }
  }
  return created.data.id;
}

async function balanceOf(token, accountId) {
  const list = await api('GET', '/api/accounts', token);
  return list.data.find((account) => account.id === accountId).balance;
}

function transfer(token, fromAccountId, toAccountId, amount) {
  return api('POST', '/api/transfers', token, {
    fromAccountId,
    toAccountId,
    amount,
    date: today,
  });
}

async function main() {
  const email = `concurrency-${Date.now()}@example.com`;
  const password = 'password123';

  const registered = await api('POST', '/api/auth/register', null, {
    name: 'Concurrency Test',
    email,
    password,
  });
  if (registered.status !== 201) {
    throw new Error(`register failed: ${JSON.stringify(registered.data)}`);
  }
  const login = await api('POST', '/api/auth/login', null, { email, password });
  if (login.status !== 200) {
    throw new Error(`login failed: ${JSON.stringify(login.data)}`);
  }
  const token = login.data.token;

  console.log('\nScenario 1: 20 parallel transfers of 100.00 from an account holding 1000.00');
  const source = await createAccount(token, 'Scenario 1 source', '1000.00');
  const target = await createAccount(token, 'Scenario 1 target', null);

  const results1 = await Promise.all(
    Array.from({ length: 20 }, () => transfer(token, source, target, '100.00'))
  );
  const counts1 = tally(results1);
  console.log(`  responses: ${JSON.stringify(counts1)}`);

  check('exactly 10 transfers succeeded (201)', counts1[201] === 10);
  check('exactly 10 transfers were refused for insufficient funds (422)', counts1[422] === 10);
  check('no server errors', Object.keys(counts1).every((code) => code === '201' || code === '422'));
  check('source balance is 0.00', (await balanceOf(token, source)) === '0.00');
  check('target balance is 1000.00', (await balanceOf(token, target)) === '1000.00');

  console.log('\nScenario 2: 10 transfers C to D and 10 transfers D to C at the same time');
  const accountC = await createAccount(token, 'Scenario 2 account C', '1000.00');
  const accountD = await createAccount(token, 'Scenario 2 account D', '1000.00');

  const jobs = [];
  for (let i = 0; i < 10; i += 1) {
    jobs.push(transfer(token, accountC, accountD, '10.00'));
    jobs.push(transfer(token, accountD, accountC, '10.00'));
  }
  const results2 = await Promise.all(jobs);
  const counts2 = tally(results2);
  console.log(`  responses: ${JSON.stringify(counts2)}`);

  check('all 20 transfers succeeded (201)', counts2[201] === 20);
  check('no deadlock errors (no 500s)', !counts2[500]);
  check('account C is back to 1000.00', (await balanceOf(token, accountC)) === '1000.00');
  check('account D is back to 1000.00', (await balanceOf(token, accountD)) === '1000.00');

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});