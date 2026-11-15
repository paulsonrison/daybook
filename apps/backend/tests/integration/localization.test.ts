import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { testApi } from './support.js';
const api = testApi();
after(() => api.pool.end());
const mutation =
  'mutation($input:AgentPreferencesInput!){saveAgentPreferences(input:$input){version}}';
const choice = (locale: string) => ({
  requestId: randomUUID(),
  version: 0,
  locale,
  mode: 'light',
  scheme: 'teal',
  layout: 'TABLE',
  fontFamily: 'inter',
  fontSize: 14,
  fontWeight: 400,
  fontStyle: 'normal',
  lineHeight: 1.45,
});

test('validation translates controlled field labels and hides formatting metadata in every locale', async () => {
  for (const locale of ['ml', 'hi', 'en']) {
    const cookie = await api.agency();
    await api.query(cookie, mutation, { input: choice(locale) });
    const result = await api.query(
      cookie,
      'mutation{saveTerritory(input:{name:"",locality:"Kochi",pinCodes:["682020"],sectors:["Lane"]}){id}}',
    );
    assert.equal(
      result.errors[0].message,
      {
        ml: 'ഈ ഫീൽഡ് ശരിയായി നൽകുക: പ്രദേശത്തിന്റെ പേര് (പരമാവധി 120 അക്ഷരങ്ങൾ).',
        hi: 'यह फ़ील्ड सही भरें: क्षेत्र का नाम (अधिकतम 120 अक्षर)।',
        en: 'Enter a valid territory name (up to 120 characters).',
      }[locale],
    );
    assert.deepEqual(result.errors[0].extensions, { code: 'BAD_USER_INPUT' });
  }
});
test('concurrent authenticated validation uses each agent locale and preserves machine error codes', async () => {
  const cookies = await Promise.all([api.agency(), api.agency()]);
  for (const [index, locale] of ['ml', 'hi'].entries())
    assert.ok(
      !(await api.query(cookies[index], mutation, { input: choice(locale) }))
        .errors,
    );
  const results = await Promise.all(
    ['ml', 'hi'].map((locale, index) =>
      api.query(cookies[index], mutation, {
        input: { ...choice(locale), version: 1, mode: 'unknown' },
      }),
    ),
  );
  assert.equal(
    results[0].errors[0].message,
    'ലൈറ്റ്, ഡാർക്ക് അല്ലെങ്കിൽ സിസ്റ്റം പ്രദർശന രീതി തിരഞ്ഞെടുക്കുക.',
  );
  assert.equal(
    results[1].errors[0].message,
    'हल्का, गहरा या सिस्टम प्रदर्शन मोड चुनें।',
  );
  assert.ok(
    results.every(
      (result) => result.errors[0].extensions.code === 'BAD_USER_INPUT',
    ),
  );
  const english = await api.agency();
  assert.equal(
    (
      await api.query(english, mutation, {
        input: { ...choice('en'), mode: 'unknown' },
      })
    ).errors[0].message,
    'Choose light, dark or system display mode.',
  );
});
test('unauthenticated validation uses the explicit supported request locale without changing authentication', async () => {
  const response = await api.fetch(
    new Request('http://localhost/graphql', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:3000',
        'content-type': 'application/json',
        'accept-language': 'hi',
      },
      body: JSON.stringify({ query: '{agentPreferences{locale}}' }),
    }),
  );
  const result = await response.json();
  assert.equal(result.errors[0].message, 'जारी रखने के लिए साइन इन करें।');
  assert.equal(result.errors[0].extensions.code, 'UNAUTHENTICATED');
});
