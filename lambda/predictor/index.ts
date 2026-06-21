import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';

const client = new BedrockRuntimeClient({
  region: process.env.BEDROCK_REGION || 'us-east-2',
});

export const handler = async (event: any) => {
  try {
    const body = JSON.parse(event.body);
    const path = event.resource || event.path || '';

    if (body.type === 'overview') {
      return await handleOverview(body);
    } else {
      return await handlePrediction(body);
    }

  } catch (error: any) {
    console.error('Error:', error);
    return response(500, { error: error.message });
  }
};

// ===== OVERVIEW — Top contenders for next race =====
export async function handleOverview(body: any) {
  const standings = await fetchDriverStandings();
  const races = await fetchRaceCalendar();

  const nextRace = findNextRace(races);
  const prompt = buildOverviewPrompt(standings, nextRace, body.circuit || nextRace?.raceName || 'next race');

  const result = await callBedrock(prompt);

  return response(200, {
    race: nextRace,
    prediction: result,
  });
}

// ===== PREDICTION — Single driver what-if =====
export async function handlePrediction(body: any) {
  const raceData = await fetchRaceCalendar();
  const driverData = await fetchDriverStandings();

  // Find the circuit the user asked about, to get its ID for the history lookup
  const matchedRace = raceData.find(
    (r: any) =>
      r.Circuit?.circuitName?.toLowerCase().includes((body.circuit || '').toLowerCase()) ||
      r.raceName?.toLowerCase().includes((body.circuit || '').toLowerCase())
  );

  // RETRIEVE: pull historical podiums for this circuit
  const history = matchedRace
    ? await fetchCircuitHistory(matchedRace.Circuit.circuitId)
    : [];

  // AUGMENT: pass history into the prompt builder
  const prompt = buildPredictionPrompt(body, raceData, driverData, history);
  const prediction = await callBedrock(prompt);

  return response(200, prediction);
}

// ===== DATA FETCHERS =====
export async function fetchDriverStandings(): Promise<any[]> {
  const res = await fetch('https://api.jolpi.ca/ergast/f1/current/driverStandings.json');
  const data = await res.json() as any;
  return data.MRData.StandingsTable.StandingsLists[0]?.DriverStandings || [];
}

export async function fetchRaceCalendar(): Promise<any[]> {
  const res = await fetch('https://api.jolpi.ca/ergast/f1/current.json');
  const data = await res.json() as any;
  return data.MRData.RaceTable.Races || [];
}

// ===== RAG: Retrieve historical results at a circuit =====
export async function fetchCircuitHistory(circuitId: string, years: number = 3): Promise<any[]> {
  const currentYear = new Date().getFullYear();

  // Build one request per past year, then run them all in parallel
  const requests = [];
  for (let i = 1; i <= years; i++) {
    const season = currentYear - i;
    requests.push(
      fetch(`https://api.jolpi.ca/ergast/f1/${season}/circuits/${circuitId}/results.json`)
        .then((res) => res.json() as any)
        .then((data) => {
          const race = data.MRData.RaceTable.Races[0];
          if (!race) return null;                 // circuit wasn't raced that year
          return {
            season,
            top3: (race.Results || []).slice(0, 3).map((r: any) => ({
              position: r.position,
              driver: `${r.Driver.givenName} ${r.Driver.familyName}`,
              team: r.Constructor.name,
            })),
          };
        })
        .catch(() => null)                        // never let one bad year crash the request
    );
  }

  const results = await Promise.all(requests);
  return results.filter((r) => r !== null);       // drop the years with no data
}

export function findNextRace(races: any[]): any {
  const now = new Date();
  const upcoming = races.find((r: any) => new Date(r.date) > now);
  return upcoming || races[races.length - 1];
}

// ===== PROMPT BUILDERS =====
export function buildOverviewPrompt(standings: any[], nextRace: any, circuit: string): string {
  const standingsText = standings
    .slice(0, 10)
    .map((s: any) =>
      `P${s.position}: ${s.Driver.givenName} ${s.Driver.familyName} (${s.Constructors[0].name}) - ${s.points} pts, ${s.wins} wins`
    )
    .join('\n');

  const raceName = nextRace?.raceName || circuit;
  const circuitName = nextRace?.Circuit?.circuitName || circuit;

  return `You are an F1 race prediction AI analyst. Predict the top 5 finishers for the upcoming race.

CURRENT 2026 SEASON STANDINGS:
${standingsText}

UPCOMING RACE: ${raceName}
CIRCUIT: ${circuitName}

Based on current form, historical performance at this circuit, and team strength, predict the top 5 finishers.

Respond ONLY in this JSON format, no other text:
{
  "contenders": [
    {
      "position": 1,
      "driver": "<full name>",
      "team": "<team name>",
      "winChance": <number 0-100>,
      "form": "<HOT|GOOD|AVERAGE|COLD>",
      "reason": "<one sentence why>"
    }
  ],
  "safetyCarChance": <number 0-100>,
  "rainChance": <number 0-100>,
  "darkHorse": {
    "driver": "<surprise pick full name>",
    "team": "<team>",
    "reason": "<why they could surprise>"
  },
  "keyBattle": "<one sentence about the most exciting battle to watch>",
  "circuitInsight": "<one sentence about what makes this circuit special>"
}`;
}

// export function buildPredictionPrompt(request: any, races: any[], standings: any[]): string {
//   const standingsText = standings
//     .slice(0, 10)
//     .map((s: any) =>
//       `P${s.position}: ${s.Driver.givenName} ${s.Driver.familyName} (${s.Constructors[0].name}) - ${s.points} pts, ${s.wins} wins`
//     )
//     .join('\n');

//   return `You are an F1 race prediction AI. Based on the data below, predict the race outcome.

// CURRENT SEASON STANDINGS:
// ${standingsText}

// RACE SETUP:
// Driver: ${request.driver}
// Circuit: ${request.circuit}
// Tyre Compound: ${request.tyres}
// Weather: ${request.weather}
// Downforce Level: ${request.downforce}
// Strategy: ${request.strategy}

// Respond ONLY in this JSON format, no other text:
// {
//   "winChance": <number 0-100>,
//   "podiumChance": <number 0-100>,
//   "expectedPosition": <number 1-20>,
//   "expectedPoints": <number>,
//   "insight": "<2-3 sentence explanation of prediction>",
//   "riskFactor": "<LOW|MEDIUM|HIGH>",
//   "optimalSetup": {
//     "tyres": "<SOFT|MEDIUM|HARD|INTERMEDIATE|WET>",
//     "strategy": "<1-STOP|2-STOP|3-STOP>",
//     "downforce": "<LOW|MEDIUM|HIGH>",
//     "winChance": <number 0-100>,
//     "explanation": "<1 sentence why this is better>"
//   },
//   "funFact": "<interesting F1 fact about this driver or circuit>"
// }`;
// }

export function buildPredictionPrompt(request: any, races: any[], standings: any[], history: any[] = []): string {
  const standingsText = standings
    .slice(0, 10)
    .map((s: any) =>
      `P${s.position}: ${s.Driver.givenName} ${s.Driver.familyName} (${s.Constructors[0].name}) - ${s.points} pts, ${s.wins} wins`
    )
    .join('\n');

  // Format the retrieved history into readable lines
  const historyText = history.length
    ? history
        .map((h: any) =>
          `  ${h.season}: ` +
          h.top3.map((d: any) => `P${d.position} ${d.driver} (${d.team})`).join(', ')
        )
        .join('\n')
    : '  No historical data available for this circuit.';

  return `You are an F1 race prediction AI. Based on the data below, predict the race outcome.

CURRENT SEASON STANDINGS:
${standingsText}

HISTORICAL RESULTS AT THIS CIRCUIT (recent years):
${historyText}

RACE SETUP:
Driver: ${request.driver}
Circuit: ${request.circuit}
Tyre Compound: ${request.tyres}
Weather: ${request.weather}
Downforce Level: ${request.downforce}
Strategy: ${request.strategy}

Respond ONLY in this JSON format, no other text:
{
  ... (keep your existing JSON schema unchanged)
}`;
}
// ===== BEDROCK =====
export async function callBedrock(prompt: string): Promise<any> {
  const modelId = process.env.BEDROCK_MODEL_ID || 'us.anthropic.claude-haiku-4-5-20251001-v1:0';

  const command = new InvokeModelCommand({
    modelId,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 800,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const res = await client.send(command);
  const responseBody = JSON.parse(new TextDecoder().decode(res.body));
  const text = responseBody.content[0].text;

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) return JSON.parse(jsonMatch[0]);
  throw new Error('Failed to parse AI response');
}

// ===== HELPERS =====
export function response(statusCode: number, body: any) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify(body),
  };
}