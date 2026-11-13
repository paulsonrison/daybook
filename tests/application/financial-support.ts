import type { Page } from '@playwright/test';
export async function financialBrowser(
  page: Page,
  origin: string,
  email: string,
  names = ['Review Resident'],
) {
  await page.request.post('/api/auth/register', {
    headers: { origin },
    data: {
      agencyName: 'Financial Review Browser',
      name: 'Owner',
      email,
      password: 'Financial review password 123',
    },
  });
  async function query(query: string, variables: Record<string, unknown> = {}) {
    return (
      await page.request.post('/api/graphql', {
        headers: { origin },
        data: { query, variables },
      })
    ).json();
  }
  const territory = (
      await query(
        'mutation{saveTerritory(input:{name:"Central",locality:"Kochi",pinCodes:["682020"],sectors:["Lotus"]}){id}}',
      )
    ).data.saveTerritory,
    route = (
      await query(
        'mutation($id:ID!){saveRoute(input:{code:"F01",name:"Lotus",territoryId:$id}){id}}',
        { id: territory.id },
      )
    ).data.saveRoute,
    residents = [];
  for (const [index, name] of names.entries()) {
    const resident = (
      await query(
        'mutation($input:ResidentInput!){saveResident(input:$input){id}}',
        {
          input: {
            requestId: crypto.randomUUID(),
            name,
            address: `${index + 1} Lotus`,
            phone: `987654321${index}`,
            routeId: route.id,
            sector: 'Lotus',
            dropOrder: index + 1,
          },
        },
      )
    ).data.saveResident;
    residents.push(resident);
    await query(
      'mutation($input:AccountAdjustmentInput!){postAdjustment(input:$input){id}}',
      {
        input: {
          requestId: crypto.randomUUID(),
          residentId: resident.id,
          direction: 'DEBIT',
          category: 'OPENING',
          amount: '20.05',
          reason: 'Imported review balance',
        },
      },
    );
  }
  return { query, route, residents };
}
