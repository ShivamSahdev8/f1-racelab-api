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

  const prompt = buildPredictionPrompt(body, raceData, driverData);
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

export function buildPredictionPrompt(request: any, races: any[], standings: any[]): string {
  const standingsText = standings
    .slice(0, 10)
    .map((s: any) =>
      `P${s.position}: ${s.Driver.givenName} ${s.Driver.familyName} (${s.Constructors[0].name}) - ${s.points} pts, ${s.wins} wins`
    )
    .join('\n');

  return `You are an F1 race prediction AI. Based on the data below, predict the race outcome.

CURRENT SEASON STANDINGS:
${standingsText}

RACE SETUP:
Driver: ${request.driver}
Circuit: ${request.circuit}
Tyre Compound: ${request.tyres}
Weather: ${request.weather}
Downforce Level: ${request.downforce}
Strategy: ${request.strategy}

Respond ONLY in this JSON format, no other text:
{
  "winChance": <number 0-100>,
  "podiumChance": <number 0-100>,
  "expectedPosition": <number 1-20>,
  "expectedPoints": <number>,
  "insight": "<2-3 sentence explanation of prediction>",
  "riskFactor": "<LOW|MEDIUM|HIGH>",
  "optimalSetup": {
    "tyres": "<SOFT|MEDIUM|HARD|INTERMEDIATE|WET>",
    "strategy": "<1-STOP|2-STOP|3-STOP>",
    "downforce": "<LOW|MEDIUM|HIGH>",
    "winChance": <number 0-100>,
    "explanation": "<1 sentence why this is better>"
  },
  "funFact": "<interesting F1 fact about this driver or circuit>"
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